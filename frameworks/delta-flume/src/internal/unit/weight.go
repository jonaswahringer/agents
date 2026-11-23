// Package unit holds what the framework fixes for every unit of work: its
// key, its weight, and the one branch its agent may write to.
package unit

import "fmt"

// Weight says how much a unit matters: criticality × urgency, on four levels,
// or None before anything has weighed it. A heavier unit reaches a human
// sooner and leaves the queue first.
type Weight int

const (
	// None: not weighed yet. It is not a level below Low, and a unit with
	// it leaves the queue last.
	None Weight = iota
	Low
	Normal
	High
	Critical
)

var weightNames = [...]string{None: "none", Low: "low", Normal: "normal", High: "high", Critical: "critical"}

func (w Weight) String() string {
	if w < None || w > Critical {
		return fmt.Sprintf("weight(%d)", int(w))
	}
	return weightNames[w]
}

// MarshalText writes a weight as its name, so JSON shows "high" and not 3.
func (w Weight) MarshalText() ([]byte, error) {
	if w < None || w > Critical {
		return nil, fmt.Errorf("weight %d is out of range", int(w))
	}
	return []byte(weightNames[w]), nil
}

func (w *Weight) UnmarshalText(text []byte) error {
	parsed, err := ParseWeight(string(text))
	if err != nil {
		return err
	}
	*w = parsed
	return nil
}

// ParseWeight reads a weight as the framework writes it: none, low, normal,
// high or critical. An empty string is none.
func ParseWeight(s string) (Weight, error) {
	if s == "" {
		return None, nil
	}
	for w := None; w <= Critical; w++ {
		if weightNames[w] == s {
			return w, nil
		}
	}
	return 0, fmt.Errorf("unknown weight %q: want none, low, normal, high or critical", s)
}
