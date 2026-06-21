/**
 * SSE Transport for cpx-store collab plugin.
 * Connects to /activity/stream and receives real-time events.
 * Implements the cpx-store transport interface: send(), onReceive(), connect(), disconnect().
 */
export class SSETransport {
  constructor(url) {
    this._url = url || '/activity/stream';
    this._handler = null;
    this._source = null;
  }

  send(_event) {
    // SSE is server→client only; writes go through existing fetch handlers
  }

  onReceive(handler) {
    this._handler = handler;
  }

  connect() {
    if (this._source) return Promise.resolve();

    return new Promise((resolve) => {
      this._source = new EventSource(this._url);

      this._source.onopen = () => resolve();

      this._source.onmessage = (e) => {
        if (!this._handler) return;
        try {
          const event = JSON.parse(e.data);
          // Map SSE events to cpx-store collab format
          this._handler({
            id: crypto.randomUUID(),
            origin: 'sse-server',
            timestamp: Date.now(),
            prop: event.type,
            type: 'set',
            value: event,
          });
        } catch (_) {}
      };

      this._source.onerror = () => {
        // EventSource auto-reconnects — just resolve if we haven't yet
        resolve();
      };
    });
  }

  disconnect() {
    if (this._source) {
      this._source.close();
      this._source = null;
    }
  }
}
