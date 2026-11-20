package unit

import (
	"fmt"
	"regexp"
	"strings"
)

// Key is a unit's idempotency key: <vessel>/<project>/<instance>/<subject>,
// for example maintenance/tiro/dependencies/lodash. It comes from the unit, not from the
// run, and leaves out whatever changes between runs, such as a version.
type Key struct {
	Vessel  string
	Project string
	// Instance is the vessel instance that owns the unit in its project, such
	// as dependencies.
	Instance string
	// Subject may contain slashes, as in @types/node.
	Subject string
}

var nameRE = regexp.MustCompile(`^[a-z0-9][a-z0-9._-]*$`)

// ParseKey reads a key and rejects one that is not in the framework's form.
func ParseKey(s string) (Key, error) {
	parts := strings.SplitN(s, "/", 4)
	if len(parts) != 4 {
		return Key{}, fmt.Errorf("key %q: want <vessel>/<project>/<instance>/<subject>", s)
	}
	k := Key{Vessel: parts[0], Project: parts[1], Instance: parts[2], Subject: parts[3]}
	for _, f := range []struct{ name, value string }{
		{"vessel", k.Vessel}, {"project", k.Project}, {"instance", k.Instance},
	} {
		if !nameRE.MatchString(f.value) {
			return Key{}, fmt.Errorf("key %q: %s %q must match %s", s, f.name, f.value, nameRE)
		}
	}
	for _, part := range strings.Split(k.Subject, "/") {
		if part == "" {
			return Key{}, fmt.Errorf("key %q: subject has an empty part", s)
		}
	}
	for _, r := range k.Subject {
		if r <= ' ' || r == 0x7f {
			return Key{}, fmt.Errorf("key %q: subject has a space or control character", s)
		}
	}
	return k, nil
}

func (k Key) String() string {
	return k.Vessel + "/" + k.Project + "/" + k.Instance + "/" + k.Subject
}

// MarshalText writes a key as its string, so JSON shows one string and not
// four fields.
func (k Key) MarshalText() ([]byte, error) { return []byte(k.String()), nil }

func (k *Key) UnmarshalText(text []byte) error {
	parsed, err := ParseKey(string(text))
	if err != nil {
		return err
	}
	*k = parsed
	return nil
}

// Branch is the only branch the unit's agent may write to:
// vessel/<vessel>/<instance>/<subject>. The project is left out because the
// branch already lives in the project's repository. The name is derived, never
// chosen, so an agent cannot pick a branch outside the convention.
func (k Key) Branch() string {
	parts := strings.Split(k.Subject, "/")
	for i, part := range parts {
		parts[i] = refPart(part)
	}
	return BranchPrefix + k.Vessel + "/" + k.Instance + "/" + strings.Join(parts, "/")
}

// BranchPrefix starts the name of every branch that belongs to a unit.
const BranchPrefix = "vessel/"

// refPart makes one path part of a subject safe for a git ref. Git forbids a
// part that starts with a dot or ends in ".lock" or a dot, the sequences ".."
// and "@{", and the characters space ~ ^ : ? * [ \ and control characters.
func refPart(s string) string {
	var b strings.Builder
	prevDot := false
	for _, r := range s {
		switch {
		case r == '.':
			if prevDot || b.Len() == 0 {
				r = '-'
			}
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9',
			r == '_', r == '-', r == '+', r == '@':
		default:
			r = '-'
		}
		prevDot = r == '.'
		b.WriteRune(r)
	}
	out := b.String()
	if strings.HasSuffix(out, ".") {
		out = out[:len(out)-1] + "-"
	}
	if strings.HasSuffix(out, ".lock") {
		out += "-"
	}
	return out
}
