package t3

import (
	"testing"
	"time"
)

// The shape is what t3 v0.1.10 prints for "thread show --json", cut down.
func TestParseShow(t *testing.T) {
	idle, err := parseShow([]byte(`{"thread":{"status":"completed","activeRunId":null,"pendingRequestCount":0,"updatedAt":"2026-11-19T13:31:57.924Z"},"messages":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	if idle.Busy || idle.Asking || idle.Status != "completed" || !idle.Changed.Equal(time.Date(2026, 11, 19, 13, 31, 57, 924e6, time.UTC)) {
		t.Errorf("idle thread = %+v", idle)
	}
	busy, err := parseShow([]byte(`{"thread":{"status":"running","activeRunId":"run-1","pendingRequestCount":1,"updatedAt":"2026-11-19T13:31:57Z"}}`))
	if err != nil || !busy.Busy || !busy.Asking {
		t.Errorf("busy thread waiting for an answer = %+v, %v", busy, err)
	}
	if _, err := parseShow([]byte(`{"error":"no such thread"}`)); err == nil {
		t.Error("an answer without a thread must fail")
	}
}
