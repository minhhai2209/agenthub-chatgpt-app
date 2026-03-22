const API_BASE = "https://api.github.com";
const ACCEPT = "application/vnd.github+json";

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export class ThreadApiClient {
  constructor({ repoSlug, token }) {
    this.repoSlug = repoSlug;
    this.token = token;
    this.viewer = null;
  }

  async request(path, { method = "GET", body = null } = {}) {
    const headers = {
      Accept: ACCEPT,
      Authorization: `Bearer ${this.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const init = { method, headers };
    if (body !== null) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const response = await fetch(`${API_BASE}${path}`, init);
    const text = await response.text();
    if (!response.ok) {
      const parsed = safeJson(text);
      const message = parsed?.message || text || `GitHub API error ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.body = parsed || text;
      throw error;
    }
    return text ? safeJson(text) ?? text : null;
  }

  async fetchViewerLogin() {
    if (this.viewer) return this.viewer;
    const viewer = await this.request("/user");
    this.viewer = viewer?.login || null;
    return this.viewer;
  }

  async fetchThread(threadNumber) {
    return this.request(`/repos/${this.repoSlug}/issues/${threadNumber}`);
  }

  async fetchComments(threadNumber) {
    const comments = [];
    let page = 1;
    while (true) {
      const batch = await this.request(
        `/repos/${this.repoSlug}/issues/${threadNumber}/comments?per_page=100&page=${page}`,
      );
      if (!Array.isArray(batch) || batch.length === 0) break;
      comments.push(...batch);
      if (batch.length < 100) break;
      page += 1;
    }
    return comments;
  }

  async createComment(threadNumber, body) {
    return this.request(`/repos/${this.repoSlug}/issues/${threadNumber}/comments`, {
      method: "POST",
      body: { body },
    });
  }

  async updateComment(messageId, body) {
    return this.request(`/repos/${this.repoSlug}/issues/comments/${messageId}`, {
      method: "PATCH",
      body: { body },
    });
  }

  async addLabels(threadNumber, labels) {
    if (!labels.length) return null;
    return this.request(`/repos/${this.repoSlug}/issues/${threadNumber}/labels`, {
      method: "POST",
      body: { labels },
    });
  }

  async removeLabel(threadNumber, label) {
    const encoded = encodeURIComponent(label);
    try {
      await this.request(`/repos/${this.repoSlug}/issues/${threadNumber}/labels/${encoded}`, {
        method: "DELETE",
      });
    } catch (error) {
      if (error?.status === 404) return;
      throw error;
    }
  }
}
