export class SerialManager {
  constructor({ onData, onStatus }) {
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.onData = onData;
    this.onStatus = onStatus;
  }

  async connect() {
    if (!('serial' in navigator)) {
      throw new Error('Web Serial not supported. Chrome/Edge 사용 권장');
    }

    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: 115200 });

    this.writer = this.port.writable.getWriter();
    this.reader = this.port.readable.getReader();

    this.onStatus?.('connected');

    await this.sendLine('mode csv');
    this.readLoop();
  }

  async sendLine(s) {
    const enc = new TextEncoder();
    await this.writer.write(enc.encode(s + '\n'));
  }

  async start() {
    await this.sendLine('start');
    this.onStatus?.('running');
  }

  async stop() {
    await this.sendLine('stop');
    this.onStatus?.('stopped');
  }

  async readLoop() {
    const dec = new TextDecoder();
    let buf = '';

    while (this.port && this.port.readable) {
      try {
        const { value, done } = await this.reader.read();
        if (done) break;

        buf += dec.decode(value, { stream: true });
        let idx;

        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);

          if (!line) continue;
          if (line.startsWith('ms,')) continue;

          const parts = line.split(',');
          if (parts.length !== 3) continue;

          const ms = parseInt(parts[0], 10);
          const dp = parseFloat(parts[1]);
          const fsr = parseInt(parts[2], 10);

          if (!Number.isNaN(ms) && !Number.isNaN(dp) && !Number.isNaN(fsr)) {
            this.onData?.({ ms, dp, fsr });
          }
        }
      } catch (e) {
        console.error(e);
        this.onStatus?.('read error');
        break;
      }
    }
  }
}
