// Package unit holds what the framework fixes for every unit of work: its
// key, its weight, and the one branch its agent may write to.
package unit

import "fmt"

// Weight says how much a unit matters: criticality × urgency, on four levels.
// A heavier unit reaches a human sooner and leaves the queue first.
type Weight int

const (
	Low Weight = iota + 1
	Normal
	High
	Critical
)

var weightNames = [...]string{Low: "low", Normal: "normal", High: "high", Critical: "critical"}

func (w Weight) String() string {
	if w < Low || w > Critical {
		return fmt.Sprintf("weight(%d)", int(w))
	}
	return weightNames[w]
}

// MarshalText writes a weight as its name, so JSON shows "high" and not 3.
func (w Weight) MarshalText() ([]byte, error) {
	if w < Low || w > Critical {
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

// ParseWeight reads a weight as the framework writes it: low, normal, high or
// critical.
func ParseWeight(s string) (Weight, error) {
	for w := Low; w <= Critical; w++ {
		if weightNames[w] == s {
			return w, nil
		}
	}
	return 0, fmt.Errorf("unknown weight %q: want low, normal, high or critical", s)
}
