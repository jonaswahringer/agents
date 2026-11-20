package main

import (
	"flag"
	"fmt"

	"github.com/jonaswahringer/delta-flume/src/internal/agent"
	"github.com/jonaswahringer/delta-flume/src/internal/t3"
)

// agentFlags adds the flags that say what runs a unit's agent.
func agentFlags(flags *flag.FlagSet) (name, t3Path *string) {
	name = flags.String("agent", "t3", "what runs the agent; flume knows: t3 (T3 Code)")
	t3Path = flags.String("t3", "t3", "t3 binary to run, when the agent runs in T3 Code")
	return name, t3Path
}

// provider is the agent provider with this name. A new one is a package that
// satisfies agent.Provider, and a case here.
func provider(name, t3Path string) (agent.Provider, error) {
	switch name {
	case "t3":
		return t3.CLI{Path: t3Path}, nil
	}
	return nil, fmt.Errorf("unknown agent provider %q; flume knows: t3", name)
}
