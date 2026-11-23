// Package client talks to a flume server. Every command and every node
// reaches the queue through it.
package client

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jonaswahringer/delta-flume/src/internal/gateway"
	"github.com/jonaswahringer/delta-flume/src/internal/unit"
	"github.com/jonaswahringer/delta-flume/src/internal/wire"
)

// limit is how long one call may take. A node's question may be held open
// by the server, so it gets its wait on top.
const limit = 30 * time.Second

// Client is a flume server at an address, such as http://127.0.0.1:7117.
type Client struct {
	base string
	http *http.Client
}

// New makes a client for the server at address.
func New(address string) (*Client, error) {
	u, err := url.Parse(address)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, fmt.Errorf("server address %q: want one like http://127.0.0.1:7117", address)
	}
	return &Client{base: strings.TrimRight(address, "/"), http: &http.Client{}}, nil
}

// Submit hands units to the gateway.
func (c *Client) Submit(ctx context.Context, submissions []gateway.Submission) ([]gateway.Decision, error) {
	return post[[]gateway.Decision](ctx, c, limit, "/v1/submit", submissions)
}

// Queue returns the units waiting to start, in start order.
func (c *Client) Queue(ctx context.Context) ([]unit.Unit, error) {
	return get[[]unit.Unit](ctx, c, "/v1/units?state=queued")
}

// Units returns every unit, by key.
func (c *Client) Units(ctx context.Context) ([]unit.Unit, error) {
	return get[[]unit.Unit](ctx, c, "/v1/units?state=all")
}

// Events returns the newest events, oldest first: at most n, or all when n
// is 0.
func (c *Client) Events(ctx context.Context, n int) ([]unit.Event, error) {
	return get[[]unit.Event](ctx, c, "/v1/events?n="+strconv.Itoa(n))
}

// Owner returns the unit that owns a branch of a project, if its agent may
// publish now.
func (c *Client) Owner(ctx context.Context, project, branch string) (unit.Unit, error) {
	return post[unit.Unit](ctx, c, limit, "/v1/owner", wire.Branch{Project: project, Branch: branch})
}

// Pushed records that a unit's agent pushed its branch.
func (c *Client) Pushed(ctx context.Context, key unit.Key) error {
	_, err := post[struct{}](ctx, c, limit, "/v1/pushed", wire.Pushed{Key: key})
	return err
}

// PullRequest records that a unit's pull request is open at url.
func (c *Client) PullRequest(ctx context.Context, key unit.Key, url string, opened bool) error {
	_, err := post[struct{}](ctx, c, limit, "/v1/pull-request", wire.PullRequest{Key: key, URL: url, Opened: opened})
	return err
}

// Sync asks what a node should be working on. The server may hold the
// question open for the report's wait.
func (c *Client) Sync(ctx context.Context, report wire.Report) (wire.Desired, error) {
	wait := time.Duration(report.WaitSeconds) * time.Second
	return post[wire.Desired](ctx, c, wait+limit, "/v1/sync", report)
}

// Started says a node started a unit's agent.
func (c *Client) Started(ctx context.Context, started wire.Started) error {
	_, err := post[struct{}](ctx, c, limit, "/v1/started", started)
	return err
}

// NotStarted says a node could not start a unit's agent. It returns the
// unit as the server now has it.
func (c *Client) NotStarted(ctx context.Context, failed wire.NotStarted) (unit.Unit, error) {
	return post[unit.Unit](ctx, c, limit, "/v1/not-started", failed)
}

func get[Out any](ctx context.Context, c *Client, path string) (Out, error) {
	return do[Out](ctx, c, limit, http.MethodGet, path, nil)
}

func post[Out any](ctx context.Context, c *Client, limit time.Duration, path string, in any) (Out, error) {
	var body bytes.Buffer
	enc := json.NewEncoder(&body)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(in); err != nil {
		var none Out
		return none, err
	}
	return do[Out](ctx, c, limit, http.MethodPost, path, &body)
}

// Unreachable is the error when the server did not answer at all. What the
// server turned down is a plain error with the server's reason.
type Unreachable struct {
	Address string
	Err     error
}

func (e *Unreachable) Error() string {
	return fmt.Sprintf("no answer from the flume server at %s: %v", e.Address, e.Err)
}

func (e *Unreachable) Unwrap() error { return e.Err }

func do[Out any](ctx context.Context, c *Client, limit time.Duration, method, path string, body io.Reader) (Out, error) {
	var out Out
	ctx, cancel := context.WithTimeout(ctx, limit)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, method, c.base+path, body)
	if err != nil {
		return out, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.http.Do(req)
	if err != nil {
		if parent := context.Cause(ctx); errors.Is(parent, context.Canceled) {
			return out, context.Canceled
		}
		var wrapped *url.Error
		if errors.As(err, &wrapped) {
			err = wrapped.Err
		}
		return out, &Unreachable{Address: c.base, Err: err}
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		var failure wire.Error
		text, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
		if json.Unmarshal(text, &failure) != nil || failure.Error == "" {
			return out, fmt.Errorf("the flume server at %s answered %s: %s", c.base, res.Status, strings.TrimSpace(string(text)))
		}
		return out, errors.New(failure.Error)
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		return out, fmt.Errorf("the flume server at %s sent an answer that is not the JSON this call returns: %w", c.base, err)
	}
	return out, nil
}
