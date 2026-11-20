package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/jonaswahringer/delta-flume/src/internal/unit"
	"github.com/jonaswahringer/delta-flume/src/internal/wire"
)

// maxBody is the largest request the server reads.
const maxBody = 32 << 20

// Handler serves the server over HTTP. Every call is JSON in and JSON out.
// A call the rules turn down answers 422 with the reason; a body that
// cannot be read answers 400.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/submit", call(s.Submit))
	mux.HandleFunc("POST /v1/sync", call(s.Sync))
	mux.HandleFunc("POST /v1/started", call(nothing(s.Started)))
	mux.HandleFunc("POST /v1/not-started", call(s.NotStarted))
	mux.HandleFunc("POST /v1/owner", call(s.Owner))
	mux.HandleFunc("POST /v1/pushed", call(nothing(s.Pushed)))
	mux.HandleFunc("POST /v1/pull-request", call(nothing(s.PullRequest)))
	mux.HandleFunc("GET /v1/units", func(w http.ResponseWriter, r *http.Request) {
		list := s.Units
		switch state := r.URL.Query().Get("state"); state {
		case "", "all":
		case string(unit.Queued):
			list = s.Queue
		default:
			fail(w, http.StatusBadRequest, fmt.Errorf("state %q: want queued or all", state))
			return
		}
		units, err := list(r.Context())
		answer(w, r, units, err)
	})
	mux.HandleFunc("GET /v1/events", func(w http.ResponseWriter, r *http.Request) {
		limit := 0
		if n := r.URL.Query().Get("n"); n != "" {
			var err error
			if limit, err = strconv.Atoi(n); err != nil || limit < 0 {
				fail(w, http.StatusBadRequest, fmt.Errorf("n is %q: want a number, 0 for all", n))
				return
			}
		}
		events, err := s.Events(r.Context(), limit)
		answer(w, r, events, err)
	})
	return mux
}

// call turns one of the server's functions into a handler: the body is its
// input, and what it returns is the answer.
func call[In, Out any](fn func(context.Context, In) (Out, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in In
		body := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBody))
		if err := body.Decode(&in); err != nil {
			fail(w, http.StatusBadRequest, fmt.Errorf("the request is not the JSON this call takes: %w", err))
			return
		}
		out, err := fn(r.Context(), in)
		answer(w, r, out, err)
	}
}

// nothing is a function with no answer of its own.
func nothing[In any](fn func(context.Context, In) error) func(context.Context, In) (struct{}, error) {
	return func(ctx context.Context, in In) (struct{}, error) { return struct{}{}, fn(ctx, in) }
}

func answer(w http.ResponseWriter, r *http.Request, out any, err error) {
	switch {
	case err == nil:
		w.Header().Set("Content-Type", "application/json")
		enc := json.NewEncoder(w)
		enc.SetEscapeHTML(false)
		enc.Encode(out)
	case errors.Is(err, context.Canceled) && r.Context().Err() != nil:
		// The caller hung up. There is nobody to answer.
	default:
		fail(w, http.StatusUnprocessableEntity, err)
	}
}

func fail(w http.ResponseWriter, status int, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	enc.Encode(wire.Error{Error: err.Error()})
}
