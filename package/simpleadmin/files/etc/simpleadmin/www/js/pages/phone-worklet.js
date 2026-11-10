'use strict';

class QModemVoipAudioProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.sequence = 0;
		this.samples = [];
		this.playback = [];
		this.dn_read = 0;
		this.muted = false;
		this.warnedRate = false;
		this.dn_buf = [];
		this.dn_pos = 0;
		this.up_buf = [];
		this.up_pos = 0;
		/* 下行零缓冲低延迟：收到即播 + 追新（水位>150ms 丢最旧对齐）。
		 * 延迟恒 ≤150ms；代价=AT 停顿后跳过停顿期间内容（用户明示接受）。
		 * 消费用读指针 + 定期压实（逐样本 shift 在 48k 手机上=音频线程
		 * O(n²) memmove，实测听感卡顿）。 */
		this.dn_started = false;
		this.port.onmessage = (event) => {
			if (event.data?.type === 'mute') {
				this.muted = event.data.muted === true;
				return;
			}
			if (event.data?.type === 'pcm' && event.data.frame instanceof ArrayBuffer)
				this.queuePlayback(event.data.frame);
		};
	}

	queuePlayback(frame) {
		const view = new DataView(frame);
		if (view.byteLength < 24 || view.getUint32(0, true) !== 0x514d5650)
			return;
		const wireRate = view.getUint32(8, true);
		if (wireRate !== 8000 && wireRate !== 48000)
			return;
		/* 线路速率 → 本机实际采样率：ctx 通常=8000（phone.js 请求）则直通；
		 * 失配时线性插值兜底。上行同理反向。原生 8k 链路=路由器零重采样。 */
		const ratio = wireRate / sampleRate;
		for (let offset = 24; offset + 1 < view.byteLength; offset += 2) {
			const sample = view.getInt16(offset, true) / 32768;
			if (ratio === 1) {
				this.playback.push(sample);
				continue;
			}
			this.dn_buf.push(sample);
			while (Math.floor(this.dn_pos) + 1 < this.dn_buf.length) {
				const base = Math.floor(this.dn_pos), frac = this.dn_pos - base;
				const a = this.dn_buf[base];
				const b = this.dn_buf[base + 1];
				this.playback.push(a + (b - a) * frac);
				this.dn_pos += ratio;
			}
			const consumed = Math.floor(this.dn_pos);
			if (consumed > 0) {
				this.dn_buf.splice(0, consumed);
				this.dn_pos -= consumed;
			}
		}
	}

	frame(samples) {
		const frame = new ArrayBuffer(24 + samples.length * 2);
		const view = new DataView(frame);
		view.setUint32(0, 0x514d5650, true);
		view.setUint8(4, 1);
		view.setUint8(5, 1);
		view.setUint8(6, 1);
		view.setUint32(8, 8000, true);
		view.setUint32(12, this.sequence++, true);
		view.setUint32(16, Math.floor(currentTime * 1000) >>> 0, true);
		view.setUint32(20, samples.length, true);
		for (let index = 0; index < samples.length; index++)
			view.setInt16(24 + index * 2, Math.max(-32768, Math.min(32767, Math.round(samples[index] * 32767))), true);
		return frame;
	}

	process(inputs, outputs) {
		/* 上行以线路规格 8k/160 组帧（原生直通协议）：ctx=8k 时零转换；
		 * AudioContext 请求 8k 不被满足时线性插值到 8k（罕见兜底）。 */
		const input = inputs[0]?.[0] || [];
		if (sampleRate === 8000) {
			for (const sample of input)
				this.samples.push(sample);
		} else {
			const up = sampleRate / 8000;
			for (let i = 0; i < input.length; i++) {
				this.up_buf.push(input[i]);
				while (Math.floor(this.up_pos) + 1 < this.up_buf.length) {
					const base = Math.floor(this.up_pos), frac = this.up_pos - base;
					const a = this.up_buf[base];
					const b = this.up_buf[base + 1];
					this.samples.push(a + (b - a) * frac);
					this.up_pos += up;
				}
				const consumed = Math.floor(this.up_pos);
				if (consumed > 0) {
					this.up_buf.splice(0, consumed);
					this.up_pos -= consumed;
				}
			}
		}
		while (this.samples.length >= 160) {
			const samples = this.samples.splice(0, 160);
			if (!this.muted) {
				const frame = this.frame(samples);
				this.port.postMessage({ type: 'pcm', frame }, [ frame ]);
			}
		}
		/* ---- 下行：零蓄水低延迟（用户取舍：延迟上限 150ms，宁断不涨延迟）----
		 * 收到即播 + 追新：生产=消费同速下不蓄水则停顿后的突发帧必须
		 * 丢最旧对齐，否则水位自然爬回停顿时长、延迟照样涨。水位超
		 * keep(150ms，用户拍板) 立即丢到 keep——延迟恒 ≤150ms，AT 停顿
		 * (>150ms 的那些) 期间静音=停顿-150ms、突发后跳过等量内容。 */
		const output = outputs[0]?.[0] || [];
		const dn_keep = Math.round(sampleRate * 0.15);
		let have = this.playback.length - this.dn_read;
		if (have > dn_keep) {
			this.playback.splice(0, this.playback.length - dn_keep);
			this.dn_read = 0;
			have = dn_keep;
		}
		if (!this.dn_started && have > 0)
			this.dn_started = true;
		let index = 0;
		if (this.dn_started) {
			for (; index < output.length; index++) {
				if (this.dn_read >= this.playback.length) {
					this.dn_started = false;
					break;
				}
				output[index] = this.playback[this.dn_read++];
			}
		}
		for (; index < output.length; index++)
			output[index] = 0;
		/* 已消费区定期压实：O(n) 每若干量子一次（替代逐样本 shift 的 O(n²)） */
		if (this.dn_read >= 1024) {
			this.playback.splice(0, this.dn_read);
			this.dn_read = 0;
		}
		return true;
	}
}

registerProcessor('sa-phone-audio', QModemVoipAudioProcessor);
