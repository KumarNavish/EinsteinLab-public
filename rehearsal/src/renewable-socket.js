/** Renew only a live carrier; never reconnect an ended conversation. */
export class RenewableSocket {
  constructor(address, {Socket = globalThis.WebSocket} = {}) {
    this.Socket = Socket; this.address = new URL(address);
    this.address.searchParams.set('carrier', 'renew-v1');
    this.sockets = new Set(); this.sequence = 0; this.renewals = 0;
    this.pending = []; this.pendingBytes = 0; this.ending = false;
    this.fencing = false; this.candidate = null; this.ticket = null;
    this.current = this.open(this.address);
  }

  get readyState() { return this.ending ? 3 : this.current.readyState; }
  get bufferedAmount() { return this.pendingBytes + (this.current.bufferedAmount || 0); }

  open(address) {
    const socket = new this.Socket(String(address)); this.sockets.add(socket);
    socket.onmessage = event => {
      if (this.ending) return;
      let value;
      try { value = JSON.parse(event.data); } catch { this.fail(); return; }
      if (value.event === 'transport_ready') {
        if (typeof value.ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.ticket)
            || !Number.isInteger(value.renew_after_ms) || value.renew_after_ms < 1 || value.renew_after_ms >= 240000) {
          this.fail(); return;
        }
        this.ticket = value.ticket;
        if (socket === this.candidate) {
          clearTimeout(this.handoffTimer);
          this.current = socket; this.candidate = null; this.fencing = false;
          socket.send(JSON.stringify({type: 'transport_ack'}));
          for (const data of this.pending) socket.send(data);
          this.pending = []; this.pendingBytes = 0;
          this.renewals++; this.onrenew?.(this.renewals);
        } else if (socket !== this.current || this.fencing) { this.fail(); return; }
        clearTimeout(this.renewTimer);
        this.renewTimer = setTimeout(() => this.renew(), value.renew_after_ms);
        return;
      }
      if (value.event === 'transport_fenced') {
        if (!this.fencing || socket !== this.current || this.candidate) { this.fail(); return; }
        const address = new URL('/api/native/renew', this.address);
        address.searchParams.set('permit', this.ticket);
        address.searchParams.set('after', String(this.sequence));
        this.candidate = this.open(address);
        return;
      }
      const sequence = value.transport_seq;
      if (!Number.isSafeInteger(sequence) || sequence < 1) { this.fail(); return; }
      if (sequence <= this.sequence) return;
      if (sequence !== this.sequence + 1) { this.fail(); return; }
      this.sequence = sequence;
      this.onmessage?.(event);
    };
    socket.onerror = () => { if (!this.ending && (socket === this.current || socket === this.candidate)) this.fail(); };
    socket.onclose = event => {
      this.sockets.delete(socket);
      if (socket !== this.current) {
        if (!this.ending && socket === this.candidate) this.fail();
        return;
      }
      if (!this.ending) this.close();
      this.onclose?.(event);
    };
    return socket;
  }

  renew() {
    if (this.ending || this.fencing || this.current.readyState !== 1 || !this.ticket) { this.fail(); return; }
    this.fencing = true;
    this.handoffTimer = setTimeout(() => this.fail(), 15000);
    this.current.send(JSON.stringify({type: 'transport_fence', after: this.sequence}));
  }

  send(data) {
    if (this.ending || this.current.readyState !== 1) throw new Error('The voice transport is closed.');
    if (typeof data === 'string') {
      let value; try { value = JSON.parse(data); } catch { /* Bridge validates application JSON. */ }
      if (value?.type === 'stop') {
        for (const socket of this.sockets) if (socket.readyState === 1) socket.send(data);
        return;
      }
    }
    if (!this.fencing) { this.current.send(data); return; }
    const size = typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.byteLength;
    if (!Number.isSafeInteger(size) || size < 0 || this.pendingBytes + size > 1048576) { this.fail(); return; }
    this.pending.push(data); this.pendingBytes += size;
  }

  fail() {
    if (this.ending) return;
    this.onerror?.({type: 'error'});
    this.close();
  }

  close() {
    if (this.ending) return;
    this.ending = true; this.ticket = null;
    clearTimeout(this.renewTimer); clearTimeout(this.handoffTimer);
    this.pending = []; this.pendingBytes = 0;
    for (const socket of this.sockets) {
      try {
        if (socket.readyState === 1) socket.send(JSON.stringify({type: 'stop'}));
        socket.close();
      } catch { /* A failed carrier cannot reopen the conversation. */ }
    }
  }
}
