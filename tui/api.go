package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type Session struct {
	Name        string `json:"name"`
	CreatedAt   string `json:"created_at"`
	Description string `json:"description"`
	Command     string `json:"command"`
	Alive       bool   `json:"alive"`
}

type APIClient struct {
	baseURL string
	client  *http.Client
}

func NewAPIClient(baseURL string) *APIClient {
	return &APIClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		client:  &http.Client{Timeout: 10 * time.Second},
	}
}

func (a *APIClient) ListSessions() ([]Session, error) {
	resp, err := a.client.Get(a.baseURL + "/api/sessions")
	if err != nil {
		return nil, fmt.Errorf("cannot reach server at %s", a.baseURL)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("server error %d: %s", resp.StatusCode, string(body))
	}
	var sessions []Session
	if err := json.NewDecoder(resp.Body).Decode(&sessions); err != nil {
		return nil, err
	}
	alive := sessions[:0]
	for _, s := range sessions {
		if s.Alive {
			alive = append(alive, s)
		}
	}
	return alive, nil
}

func (a *APIClient) CreateSession(description, command string) (*Session, error) {
	payload, _ := json.Marshal(map[string]string{
		"description": description,
		"command":     command,
	})
	resp, err := a.client.Post(a.baseURL+"/api/sessions", "application/json", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 201 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("%s", strings.TrimSpace(string(body)))
	}
	var s Session
	json.NewDecoder(resp.Body).Decode(&s)
	return &s, nil
}

func (a *APIClient) DeleteSession(name string) error {
	req, _ := http.NewRequest("DELETE", a.baseURL+"/api/sessions/"+url.PathEscape(name), nil)
	resp, err := a.client.Do(req)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

func (a *APIClient) GetSnapshot(name string) (string, error) {
	resp, err := a.client.Get(a.baseURL + "/api/sessions/" + url.PathEscape(name) + "/snapshot")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var result struct {
		Text string `json:"text"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	return result.Text, nil
}

func (a *APIClient) Summarize(name string) (string, error) {
	client := &http.Client{Timeout: 60 * time.Second}
	req, _ := http.NewRequest("POST", a.baseURL+"/api/sessions/"+url.PathEscape(name)+"/summarize", nil)
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var result struct {
		Description string `json:"description"`
	}
	json.NewDecoder(resp.Body).Decode(&result)
	return result.Description, nil
}

func (a *APIClient) WebSocketURL(name string) string {
	base := a.baseURL
	if strings.HasPrefix(base, "https://") {
		base = "wss://" + base[len("https://"):]
	} else if strings.HasPrefix(base, "http://") {
		base = "ws://" + base[len("http://"):]
	}
	return base + "/ws/sessions/" + url.PathEscape(name)
}

func timeAgo(s string) string {
	var t time.Time
	var err error
	for _, layout := range []string{
		"2006-01-02 15:04:05",
		time.RFC3339,
		"2006-01-02T15:04:05.000Z",
		"2006-01-02T15:04:05Z",
	} {
		t, err = time.Parse(layout, s)
		if err == nil {
			break
		}
	}
	if err != nil {
		return s
	}

	d := time.Since(t)
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		m := int(d.Minutes())
		return fmt.Sprintf("%dm ago", m)
	case d < 24*time.Hour:
		h := int(d.Hours())
		return fmt.Sprintf("%dh ago", h)
	default:
		days := int(d.Hours() / 24)
		return fmt.Sprintf("%dd ago", days)
	}
}
