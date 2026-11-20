// Package scan turns a dependency scan into maintenance findings: one per
// dependency with a security advisory, each with its key and weight.
package scan

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/jonaswahringer/delta-flume/src/internal/unit"
)

// Finding is one maintenance unit: a dependency with at least one security
// advisory against an installed version. The key leaves out the version, so
// every advisory for a dependency lands in the same finding and the same PR.
type Finding struct {
	Key    string      `json:"key"`
	Weight unit.Weight `json:"weight"`
	// Root is the folder that was scanned: where the project lives on this
	// machine, so the unit can be started there.
	Root       string     `json:"root"`
	Package    string     `json:"package"`
	Ecosystem  string     `json:"ecosystem"`
	Versions   []string   `json:"versions"`
	Sources    []string   `json:"sources"`
	Advisories []Advisory `json:"advisories"`
}

// Advisory is one vulnerability, however many databases list it.
type Advisory struct {
	ID      string   `json:"id"`
	Aliases []string `json:"aliases,omitempty"`
	Summary string   `json:"summary,omitempty"`
	Rating  Rating   `json:"rating"`
	// Score is the CVSS base score as the scanner reports it, such as "7.2".
	Score string `json:"score,omitempty"`
	// Fixed lists the versions that fix it, as the advisory names them.
	Fixed []string `json:"fixed,omitempty"`
	// Malware is true when the package itself is malicious, not merely
	// vulnerable. Such an advisory has no fixed version.
	Malware bool `json:"malware,omitempty"`
}

// Malicious reports whether any advisory says the package itself is malware.
func (f Finding) Malicious() bool {
	for _, a := range f.Advisories {
		if a.Malware {
			return true
		}
	}
	return false
}

// Rating is an advisory's CVSS rating.
type Rating string

const (
	RatingCritical Rating = "critical"
	RatingHigh     Rating = "high"
	RatingMedium   Rating = "medium"
	RatingLow      Rating = "low"
	// RatingUnrated marks an advisory with no score and no rating.
	RatingUnrated Rating = "unrated"
)

// unratedWeight is the weight of a vulnerability nobody rated. The maintenance
// vessel's weight table has no row for it yet; high keeps it from sinking to
// the bottom of the queue.
const unratedWeight = unit.High

// malwarePrefix starts the id of every advisory in the OpenSSF malicious
// packages database, which OSV.dev serves. These advisories carry no score.
const malwarePrefix = "MAL-"

// weight follows the maintenance vessel's table: Critical → critical,
// High → high, Medium → normal, Low → low.
func (r Rating) weight() unit.Weight {
	switch r {
	case RatingCritical:
		return unit.Critical
	case RatingHigh:
		return unit.High
	case RatingMedium:
		return unit.Normal
	case RatingLow:
		return unit.Low
	}
	return unratedWeight
}

// rank orders ratings from unrated to critical.
func (r Rating) rank() int {
	switch r {
	case RatingCritical:
		return 4
	case RatingHigh:
		return 3
	case RatingMedium:
		return 2
	case RatingLow:
		return 1
	}
	return 0
}

// rate maps a CVSS base score to its rating. Without a usable score it falls
// back to the rating word a database gave, such as GitHub's MODERATE.
func rate(score, word string) Rating {
	if s, err := strconv.ParseFloat(score, 64); err == nil && s > 0 {
		switch {
		case s >= 9:
			return RatingCritical
		case s >= 7:
			return RatingHigh
		case s >= 4:
			return RatingMedium
		}
		return RatingLow
	}
	switch strings.ToUpper(word) {
	case "CRITICAL":
		return RatingCritical
	case "HIGH":
		return RatingHigh
	case "MODERATE", "MEDIUM":
		return RatingMedium
	case "LOW":
		return RatingLow
	}
	return RatingUnrated
}

// report is the part of osv-scanner's JSON output that findings need.
type report struct {
	Results []struct {
		Source struct {
			Path string `json:"path"`
		} `json:"source"`
		Packages []struct {
			Package struct {
				Name      string `json:"name"`
				Version   string `json:"version"`
				Ecosystem string `json:"ecosystem"`
			} `json:"package"`
			Groups          []group         `json:"groups"`
			Vulnerabilities []vulnerability `json:"vulnerabilities"`
		} `json:"packages"`
	} `json:"results"`
}

// group is one vulnerability under every ID that databases gave it.
type group struct {
	IDs         []string `json:"ids"`
	Aliases     []string `json:"aliases"`
	MaxSeverity string   `json:"max_severity"`
}

type vulnerability struct {
	ID               string   `json:"id"`
	Aliases          []string `json:"aliases"`
	Summary          string   `json:"summary"`
	DatabaseSpecific struct {
		Severity any `json:"severity"`
	} `json:"database_specific"`
	Affected []struct {
		Package struct {
			Name      string `json:"name"`
			Ecosystem string `json:"ecosystem"`
		} `json:"package"`
		Ranges []struct {
			Events []struct {
				Fixed string `json:"fixed"`
			} `json:"events"`
		} `json:"ranges"`
	} `json:"affected"`
}

// Findings reads an osv-scanner JSON report for a project and returns its
// findings, heaviest first. They belong to the project's instance of the
// maintenance vessel that keeps its dependencies, and carry its name in
// their keys. Sources are shown relative to root, the scanned
// directory. The same report always gives the same findings in the same order.
func Findings(reportJSON []byte, project, instance, root string) ([]Finding, error) {
	var rep report
	if err := json.Unmarshal(reportJSON, &rep); err != nil {
		return nil, fmt.Errorf("read scan report: %w", err)
	}

	type pkgID struct{ ecosystem, name string }
	type entry struct {
		versions, sources set
		advisories        map[string]*advisory
	}
	entries := map[pkgID]*entry{}

	for _, result := range rep.Results {
		source := result.Source.Path
		if rel, err := filepath.Rel(root, source); err == nil && !strings.HasPrefix(rel, "..") {
			source = filepath.ToSlash(rel)
		}
		for _, p := range result.Packages {
			groups := p.Groups
			if len(groups) == 0 {
				for _, v := range p.Vulnerabilities {
					groups = append(groups, group{IDs: []string{v.ID}, Aliases: v.Aliases})
				}
			}
			if len(groups) == 0 {
				continue
			}
			id := pkgID{p.Package.Ecosystem, p.Package.Name}
			e := entries[id]
			if e == nil {
				e = &entry{versions: set{}, sources: set{}, advisories: map[string]*advisory{}}
				entries[id] = e
			}
			e.versions.add(p.Package.Version)
			e.sources.add(source)
			for _, g := range groups {
				if len(g.IDs) == 0 {
					continue
				}
				a := newAdvisory(g, p.Vulnerabilities, id.ecosystem, id.name)
				if seen := e.advisories[a.id]; seen != nil {
					seen.fixed.addAll(a.fixed)
					seen.malware = seen.malware || a.malware
					continue
				}
				e.advisories[a.id] = a
			}
		}
	}

	findings := make([]Finding, 0, len(entries))
	for id, e := range entries {
		key, err := unit.ParseKey("maintenance/" + project + "/" + instance + "/" + id.name)
		if err != nil {
			return nil, err
		}
		f := Finding{
			Key:       key.String(),
			Root:      root,
			Package:   id.name,
			Ecosystem: id.ecosystem,
			Versions:  e.versions.sorted(),
			Sources:   e.sources.sorted(),
		}
		for _, a := range e.advisories {
			rating := rate(a.score, a.word)
			w := rating.weight()
			if a.malware {
				// A malicious package is critical whatever its rating.
				w = unit.Critical
			}
			if w > f.Weight {
				f.Weight = w
			}
			f.Advisories = append(f.Advisories, Advisory{
				ID:      a.id,
				Aliases: a.aliases.sorted(),
				Summary: a.summary,
				Rating:  rating,
				Score:   a.score,
				Fixed:   a.fixed.sorted(),
				Malware: a.malware,
			})
		}
		sort.Slice(f.Advisories, func(i, j int) bool { return f.Advisories[i].ID < f.Advisories[j].ID })
		findings = append(findings, f)
	}
	sort.Slice(findings, func(i, j int) bool {
		a, b := findings[i], findings[j]
		if a.Weight != b.Weight {
			return a.Weight > b.Weight
		}
		if a.Key != b.Key {
			return a.Key < b.Key
		}
		return a.Ecosystem < b.Ecosystem
	})
	return findings, nil
}

// advisory collects one group's details from the vulnerability records.
type advisory struct {
	id, summary, score, word string
	aliases, fixed           set
	malware                  bool
}

func newAdvisory(g group, vulns []vulnerability, ecosystem, name string) *advisory {
	ids := append([]string(nil), g.IDs...)
	sort.Strings(ids)
	a := &advisory{id: ids[0], score: g.MaxSeverity, aliases: set{}, fixed: set{}}
	a.aliases.addAll(setOf(g.Aliases))
	a.aliases.addAll(setOf(ids))

	inGroup := setOf(ids)
	for _, v := range vulns {
		if !inGroup[v.ID] {
			continue
		}
		a.aliases.addAll(setOf(v.Aliases))
		if v.ID == a.id || a.summary == "" {
			a.summary = v.Summary
		}
		if word, ok := v.DatabaseSpecific.Severity.(string); ok && rate("", word).rank() > rate("", a.word).rank() {
			a.word = word
		}
		for _, affected := range v.Affected {
			if affected.Package.Name != name || affected.Package.Ecosystem != ecosystem {
				continue
			}
			for _, r := range affected.Ranges {
				for _, event := range r.Events {
					a.fixed.add(event.Fixed)
				}
			}
		}
	}
	for id := range a.aliases {
		if strings.HasPrefix(id, malwarePrefix) {
			a.malware = true
		}
	}
	delete(a.aliases, a.id)
	return a
}

type set map[string]bool

func setOf(values []string) set {
	s := set{}
	for _, v := range values {
		s.add(v)
	}
	return s
}

func (s set) add(v string) {
	if v != "" {
		s[v] = true
	}
}

func (s set) addAll(other set) {
	for v := range other {
		s[v] = true
	}
}

func (s set) sorted() []string {
	out := make([]string, 0, len(s))
	for v := range s {
		out = append(out, v)
	}
	sort.Strings(out)
	return out
}
