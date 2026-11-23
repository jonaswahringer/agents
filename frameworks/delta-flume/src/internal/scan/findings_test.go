package scan

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"

	"github.com/jonaswahringer/delta-flume/src/internal/unit"
)

// testdata/report.json is real osv-scanner 2.7.1 output for a lockfile with
// lodash 4.17.15, minimist 1.2.5 and left-pad 1.3.0, trimmed to the fields
// flume reads.
func realReport(t *testing.T) []byte {
	t.Helper()
	data, err := os.ReadFile("testdata/report.json")
	if err != nil {
		t.Fatal(err)
	}
	return data
}

func TestFindingsFromRealReport(t *testing.T) {
	findings, err := Findings(realReport(t), "tiro", "dependencies", "/work/tiro")
	if err != nil {
		t.Fatal(err)
	}
	if len(findings) != 2 {
		t.Fatalf("got %d findings, want 2 (left-pad has no advisory)", len(findings))
	}

	minimist := findings[0]
	if minimist.Key != "maintenance/tiro/dependencies/minimist" || minimist.Weight != unit.Critical {
		t.Errorf("heaviest finding = %s (%s), want minimist (critical)", minimist.Key, minimist.Weight)
	}
	if !reflect.DeepEqual(minimist.Versions, []string{"1.2.5"}) || !reflect.DeepEqual(minimist.Sources, []string{"package-lock.json"}) {
		t.Errorf("minimist versions %v, sources %v", minimist.Versions, minimist.Sources)
	}
	advisory := minimist.Advisories[0]
	if advisory.ID != "GHSA-xvch-5gv4-984h" || advisory.Rating != RatingCritical || advisory.Score != "9.8" {
		t.Errorf("minimist advisory = %+v", advisory)
	}
	if !reflect.DeepEqual(advisory.Aliases, []string{"CVE-2021-44906"}) {
		t.Errorf("minimist aliases = %v, want the CVE id without the advisory's own id", advisory.Aliases)
	}
	if len(advisory.Fixed) == 0 || advisory.Summary == "" {
		t.Errorf("minimist advisory lacks a fixed version or a summary: %+v", advisory)
	}

	lodash := findings[1]
	if lodash.Key != "maintenance/tiro/dependencies/lodash" || lodash.Weight != unit.High {
		t.Errorf("second finding = %s (%s), want lodash (high)", lodash.Key, lodash.Weight)
	}
	var ratings []Rating
	for _, a := range lodash.Advisories {
		ratings = append(ratings, a.Rating)
	}
	// Sorted by id: scores 5.3, 7.2, 7.4, 8.1, 6.9.
	want := []Rating{RatingMedium, RatingHigh, RatingHigh, RatingHigh, RatingMedium}
	if !reflect.DeepEqual(ratings, want) {
		t.Errorf("lodash ratings = %v, want %v", ratings, want)
	}
}

func TestFindingsAreDeterministic(t *testing.T) {
	var first []byte
	for i := 0; i < 20; i++ {
		findings, err := Findings(realReport(t), "tiro", "dependencies", "/work/tiro")
		if err != nil {
			t.Fatal(err)
		}
		got, err := json.Marshal(findings)
		if err != nil {
			t.Fatal(err)
		}
		if first == nil {
			first = got
		} else if string(got) != string(first) {
			t.Fatalf("run %d differs from run 0", i)
		}
	}
}

func TestFindingsMergeLockfiles(t *testing.T) {
	const report = `{"results": [
	  {"source": {"path": "/work/tiro/package-lock.json"}, "packages": [
	    {"package": {"name": "@scope/pkg", "version": "1.0.0", "ecosystem": "npm"},
	     "groups": [{"ids": ["GHSA-b", "GHSA-a"], "aliases": ["CVE-1", "GHSA-a", "GHSA-b"], "max_severity": "3.1"}],
	     "vulnerabilities": [
	       {"id": "GHSA-a", "summary": "first", "affected": [
	         {"package": {"name": "@scope/pkg", "ecosystem": "npm"}, "ranges": [{"events": [{"introduced": "0"}, {"fixed": "1.0.1"}]}]},
	         {"package": {"name": "other", "ecosystem": "npm"}, "ranges": [{"events": [{"fixed": "9.9.9"}]}]}]},
	       {"id": "GHSA-b", "summary": "second"}]}]},
	  {"source": {"path": "/work/tiro/web/bun.lock"}, "packages": [
	    {"package": {"name": "@scope/pkg", "version": "0.9.0", "ecosystem": "npm"},
	     "groups": [{"ids": ["GHSA-a"], "max_severity": "3.1"}],
	     "vulnerabilities": [{"id": "GHSA-a", "summary": "first"}]}]}
	]}`
	findings, err := Findings([]byte(report), "tiro", "dependencies", "/work/tiro")
	if err != nil {
		t.Fatal(err)
	}
	want := []Finding{{
		Key:       "maintenance/tiro/dependencies/@scope/pkg",
		Weight:    unit.Low,
		Package:   "@scope/pkg",
		Ecosystem: "npm",
		Versions:  []string{"0.9.0", "1.0.0"},
		Sources:   []string{"package-lock.json", "web/bun.lock"},
		Advisories: []Advisory{{
			ID:      "GHSA-a",
			Aliases: []string{"CVE-1", "GHSA-b"},
			Summary: "first",
			Rating:  RatingLow,
			Score:   "3.1",
			Fixed:   []string{"1.0.1"},
		}},
	}}
	if !reflect.DeepEqual(findings, want) {
		t.Errorf("got  %+v\nwant %+v", findings, want)
	}
}

func TestRatingWithoutAScore(t *testing.T) {
	const report = `{"results": [{"source": {"path": "/p/Cargo.lock"}, "packages": [
	  {"package": {"name": "worded", "version": "1", "ecosystem": "crates.io"},
	   "groups": [{"ids": ["GHSA-w"], "max_severity": ""}],
	   "vulnerabilities": [{"id": "GHSA-w", "database_specific": {"severity": "MODERATE"}}]},
	  {"package": {"name": "unrated", "version": "1", "ecosystem": "crates.io"},
	   "vulnerabilities": [{"id": "RUSTSEC-1", "database_specific": {"severity": 7}}]},
	  {"package": {"name": "malware", "version": "1", "ecosystem": "crates.io"},
	   "groups": [{"ids": ["MAL-1"], "aliases": ["MAL-1"], "max_severity": ""}],
	   "vulnerabilities": [{"id": "MAL-1", "database_specific": {"malicious-packages-origins": []}}]},
	  {"package": {"name": "aliased-malware", "version": "1", "ecosystem": "crates.io"},
	   "groups": [{"ids": ["GHSA-m"], "aliases": ["GHSA-m", "MAL-2"], "max_severity": "2.0"}],
	   "vulnerabilities": [{"id": "GHSA-m"}]}
	]}]}`
	findings, err := Findings([]byte(report), "p", "dependencies", "/p")
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]Finding{}
	for _, f := range findings {
		got[f.Package] = f
	}
	for _, want := range []struct {
		pkg     string
		rating  Rating
		weight  unit.Weight
		malware bool
	}{
		{"worded", RatingMedium, unit.Normal, false},
		{"unrated", RatingUnrated, unit.High, false},
		// A malicious package is critical whatever its rating says.
		{"malware", RatingUnrated, unit.Critical, true},
		{"aliased-malware", RatingLow, unit.Critical, true},
	} {
		f, ok := got[want.pkg]
		if !ok {
			t.Errorf("%s: no finding", want.pkg)
			continue
		}
		a := f.Advisories[0]
		if a.Rating != want.rating || f.Weight != want.weight || a.Malware != want.malware || f.Malicious() != want.malware {
			t.Errorf("%s: rating %s, weight %s, malware %v; want %s, %s, %v",
				want.pkg, a.Rating, f.Weight, a.Malware, want.rating, want.weight, want.malware)
		}
	}
	// Critical findings sort first, so both malicious packages lead.
	if !findings[0].Malicious() || !findings[1].Malicious() {
		t.Errorf("order = %s, %s, ...; want the malicious packages first", findings[0].Package, findings[1].Package)
	}
}

// testdata/malware.json is real osv-scanner 2.7.1 output for flatmap-stream
// 0.1.1, the malicious package behind the 2018 event-stream incident.
func TestMalwareInARealReport(t *testing.T) {
	data, err := os.ReadFile("testdata/malware.json")
	if err != nil {
		t.Fatal(err)
	}
	findings, err := Findings(data, "fx", "dependencies", "/work/fx")
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range findings {
		if f.Package != "flatmap-stream" {
			continue
		}
		for _, a := range f.Advisories {
			if a.ID == "MAL-2025-20690" {
				if !a.Malware || a.Rating != RatingUnrated || len(a.Fixed) != 0 {
					t.Errorf("MAL advisory = %+v; want malware, unrated, no fixed version", a)
				}
				return
			}
		}
	}
	t.Error("no MAL-2025-20690 advisory for flatmap-stream")
}

func TestFindingsWithNothingToReport(t *testing.T) {
	findings, err := Findings([]byte(`{"results": []}`), "tiro", "dependencies", "/work/tiro")
	if err != nil || findings == nil || len(findings) != 0 {
		t.Errorf("clean report: findings %v, err %v; want an empty list", findings, err)
	}
	if _, err := Findings([]byte(`not json`), "tiro", "dependencies", "/work/tiro"); err == nil {
		t.Error("a report that is not JSON must fail")
	}
	bad := `{"results": [{"packages": [{"package": {"name": "a b"}, "groups": [{"ids": ["X"]}]}]}]}`
	if _, err := Findings([]byte(bad), "tiro", "dependencies", "/work/tiro"); err == nil {
		t.Error("a package name that cannot be a key must fail, not vanish")
	}
}
