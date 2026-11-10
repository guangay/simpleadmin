/* SimpleAdmin 电话模块（BG 电话 v0.1）
 * 控制面：SA /api/voip → ubus qmodem_voip（白名单见 Rust voip::METHODS）
 * 媒体面：浏览器 ⇄ uhttpd 443 反代 voipd WSS（/qmodem-voip/media，48kHz 帧协议，
 *         token 走 WebSocket 子协议 qmodem-voip-token.<token>，与上游 LuCI 应用同协议）
 * 通讯录：localStorage（v1），后续可接 SIM 导入（AT+CPBR）/ vCard
 */
function fetchPhone() {
	const PHONE_CONTACTS_KEY = 'sa_phone_contacts_v1';
	const CALL_STATES = ['disabled', 'idle', 'outgoing_setup', 'incoming_ringing', 'early_media', 'active', 'terminating', 'recovering', 'fault'];
	const ACTIVE_STATES = ['outgoing_setup', 'early_media', 'active'];

	const loadContacts = () => {
		try {
			const raw = JSON.parse(localStorage.getItem(PHONE_CONTACTS_KEY) || '[]');
			return Array.isArray(raw) ? raw.filter(c => c && c.name && c.tel) : [];
		} catch (_) { return []; }
	};
	const saveContacts = (list) => {
		try { localStorage.setItem(PHONE_CONTACTS_KEY, JSON.stringify(list)); }
		catch (_) { /* 存储满/隐私模式：内存仍可用 */ }
	};
	const fmtNumber = (raw) => {
		const d = String(raw || '').replace(/[^\d*#+]/g, '');
		if (d.length === 11 && d.startsWith('1')) return d.slice(0, 3) + ' ' + d.slice(3, 7) + ' ' + d.slice(7);
		return d;
	};
	const telKey = (tel) => String(tel || '').replace(/[^\d*#+]/g, '');
	const EMERGENCY = ['110', '119', '120', '122', '112'];

	return {
		// ---- 状态 ----
		phoneTab: 'keypad',
		phoneDial: '',
		phoneStatus: null,
		phoneCaps: null,
		phoneBusy: false,
		phoneError: '',
		phoneNotice: '',
		phoneCopyBuf: '',
		phoneWakeLock: null,
		phoneMediaRetry: 0,
		phoneWatchTimer: null,
		phoneCallSeconds: 0,
		phonePollTimer: null,
		phoneTickTimer: null,
		phoneContacts: loadContacts(),
		phoneContactSearch: '',
		phoneContactEditor: null,
		phoneHistory: [],
		phoneHistoryLoaded: false,
		phoneHistoryFilter: 'all',
		// 运营商/双卡
		phoneNet: { provider: '', mode: '', slot: '', slots: [] },
		phoneSlotBusy: false,
		phoneUssd: '',
		phoneUssdBusy: false,
		phoneUssdReply: '',
		phoneLteBoost: localStorage.getItem('sa_phone_lte_boost') === '1',
		// 媒体面
		phoneMediaState: 'idle', // idle|starting|open|error
		phoneMediaError: '',
		phoneMuted: false,
		phoneDtmfBuf: '',
		phoneShowDtmf: false,
		phoneAudio: null, // {ctx, stream, node, ws, sessionId}

		// ---- 基础 ----
		async phoneApi(method, params) {
			const response = await SimpleAdmin.Api.request('/api/voip', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ method, params: params || {} })
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok) throw new Error(data.error || data.message || ('HTTP ' + response.status));
			if (data.error) throw new Error(data.error);
			return data;
		},
		phoneState() { return (this.phoneStatus && CALL_STATES.includes(this.phoneStatus.state)) ? this.phoneStatus.state : 'idle'; },
		phoneInCall() { return ACTIVE_STATES.includes(this.phoneState()) || this.phoneMediaState === 'open'; },
		phoneRemote() {
			const s = this.phoneStatus || {};
			return s.remote_number || this.phoneDial || '';
		},
		phoneRemoteName() {
			const n = telKey(this.phoneRemote());
			if (!n) return '';
			const c = this.phoneContacts.find(x => telKey(x.tel) === n);
			return c ? c.name : '';
		},
		phoneIsEmergency() { return EMERGENCY.includes(telKey(this.phoneDial)); },
		phoneSecure() { return window.isSecureContext === true; },
		/* https 端口不写死：优先取 SA 实际监听（/api/webui_settings），探测一次缓存 */
		phoneHttpsBase: '',
		phoneHttpsPortCached: '',
		async phoneHttpsPort() {
			if (this.phoneHttpsPortCached) return this.phoneHttpsPortCached;
			let port = '8443';
			try {
				const w = await (await SimpleAdmin.Api.request('/api/webui_settings')).json();
				const addr = w.https || w.httpsAddress || '';
				const m = String(addr).match(/:(\d+)$/);
				if (m) port = m[1];
			} catch (_) { }
			this.phoneHttpsPortCached = port;
			return port;
		},
		/* https 域名解析为数据字段（模板/复制一律同步取 phoneHttpsBase，
		 * 异步函数只在此处物化——此前模板直接调异步函数渲染出 "[object Promise]"） */
		async phoneHttpsResolve() {
			if (window.isSecureContext && window.location.protocol === 'https:')
				this.phoneHttpsBase = window.location.origin;
			else
				this.phoneHttpsBase = 'https://' + window.location.hostname + ':' + (await this.phoneHttpsPort());
		},
		phoneHttpsUrl() { return (this.phoneHttpsBase || '') + '/#phone'; },
		phoneCopyText(text, label) {
			// 嵌入 iframe（跨源）或非安全上下文里 clipboard API 会拒绝：
			// 三级降级——异步 API → execCommand 同步复制 → 就地显示可全选输入框。
			const fallbackShow = () => {
				this.phoneCopyBuf = text;
				this.phoneNotice = '自动复制不可用（嵌入/权限限制），请长按或全选下方内容复制：';
			};
			const legacyCopy = () => {
				try {
					const ta = document.createElement('textarea');
					ta.value = text;
					ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
					document.body.appendChild(ta);
					ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
					const ok = document.execCommand('copy');
					document.body.removeChild(ta);
					return ok;
				} catch (e) { return false; }
			};
			if (navigator.clipboard && window.isSecureContext) {
				navigator.clipboard.writeText(text).then(
					() => { this.phoneNotice = label + '已复制'; this.phoneCopyBuf = ''; },
					() => { if (!legacyCopy()) fallbackShow(); else { this.phoneNotice = label + '已复制'; this.phoneCopyBuf = ''; } });
			} else if (legacyCopy()) {
				this.phoneNotice = label + '已复制'; this.phoneCopyBuf = '';
			} else {
				fallbackShow();
			}
		},
		phoneCopyHttps() { this.phoneCopyText(this.phoneHttpsUrl() || window.location.origin, 'https 地址'); },
		phoneCopyCertUrl() { this.phoneCopyText(window.location.origin + '/xgp-ca.crt', '证书链接'); },

		// ---- 轮询与生命周期 ----
		async phonePoll() {
			try {
				const snap = await this.phoneApi('status');
				const prev = this.phoneState();
				this.phoneStatus = snap;
				const now = this.phoneState();
				if (now === 'active' && prev !== 'active') this.phoneMediaStart();
				if (now === 'incoming_ringing' && prev !== 'incoming_ringing') this.phoneNotifyIncoming();
				if (!ACTIVE_STATES.includes(now) && prev !== now) this.phoneMediaStop();
				if (!ACTIVE_STATES.includes(now) && this.phoneCallSeconds) this.phoneCallSeconds = 0;
				this.phoneError = '';
			} catch (e) {
				this.phoneError = String(e.message || e);
			}
		},
		phoneStartPolling() {
			this.phoneStopPolling();
			this.phonePoll();
			const fast = ACTIVE_STATES.includes(this.phoneState()) || this.phoneState() === 'incoming_ringing';
			this.phonePollTimer = setInterval(() => this.phonePoll(), fast ? 700 : 4000);
		},
		phoneStopPolling() {
			if (this.phonePollTimer) { clearInterval(this.phonePollTimer); this.phonePollTimer = null; }
			if (this.phoneTickTimer) { clearInterval(this.phoneTickTimer); this.phoneTickTimer = null; }
		},
		phoneNotifyIncoming() {
			try {
				if (document.hidden && 'Notification' in window && Notification.permission === 'granted')
					new Notification('来电', { body: this.phoneRemoteName() || fmtNumber(this.phoneRemote()) });
			} catch (_) { /* 通知被拒绝/不支持 */ }
			this.phoneTab = 'keypad';
		},
		async init() {
			this.phoneHttpsResolve();
			try { this.phoneCaps = await this.phoneApi('capabilities'); } catch (_) { this.phoneCaps = null; }
			this.phoneStartPolling();
			this.phoneLoadNet();
			window.addEventListener('simpleadmin:page-changed', (event) => {
				if (event.detail && event.detail.id === 'phone') { this.phoneHttpsResolve(); this.phoneStartPolling(); this.phoneLoadNet(); }
			});
			/* 页面回前台（解锁/切回）：恢复挂起的音频上下文，通话中媒体断链自动重建（BG199j） */
			document.addEventListener('visibilitychange', () => {
				if (document.visibilityState !== 'visible') return;
				const a = this.phoneAudio;
				if (a && a.ctx && a.ctx.state === 'suspended') { a.ctx.resume().catch(() => {}); }
				if (this.phoneInCall() && this.phoneMediaState !== 'open') this.phoneRestartMedia();
				this.phoneAcquireWakeLock();
			});
		},
		// ---- 运营商/双卡（复用 SA 网络接口：dashboard_data 的 network_provider/network_mode + network_data 的 sim 槽位）----
		async phoneLoadNet() {
			try {
				const d = await (await SimpleAdmin.Api.request('/api/dashboard_data')).json();
				this.phoneNet.provider = d.network_provider || '';
				this.phoneNet.mode = d.network_mode || '';
			} catch (_) { }
			try {
				const n = await (await SimpleAdmin.Api.request('/api/network_data')).json();
				this.phoneNet.slot = String(n.sim || '');
				this.phoneNet.slots = Array.isArray(n.simSlots) ? n.simSlots.map(String) : [];
			} catch (_) { }
		},
		async phoneSwitchSlot(slot) {
			if (this.phoneSlotBusy || !slot || slot === this.phoneNet.slot) return;
			if (!window.confirm('切换到 SIM 卡槽 ' + slot + ' 将重启模组（数据断开约 1 分钟），确认继续？')) return;
			this.phoneSlotBusy = true;
			try {
				await SimpleAdmin.Api.networkData({ action: 'set_sim_slot', slot: Number(slot) });
				this.phoneNotice = '已切卡，等待模组重启与网络注册…';
				await this.phoneLoadNet();
			} catch (e) { this.phoneError = '切卡失败：' + (e.message || e); }
			finally { this.phoneSlotBusy = false; }
		},
		async phoneSendUssd() {
			const code = (this.phoneUssd || '').trim();
			if (!code || this.phoneUssdBusy) return;
			this.phoneUssdBusy = true;
			this.phoneUssdReply = '';
			try {
				await SimpleAdmin.Api.networkData({ action: 'send_ussd', content: code });
				/* CUSD 回复异步到达：轮询 CUSD 响应缓存（network_data 带出） */
				for (let i = 0; i < 10; i++) {
					await new Promise(r => setTimeout(r, 1500));
					const n = await (await SimpleAdmin.Api.request('/api/network_data')).json();
					if (n.ussdReply) { this.phoneUssdReply = n.ussdReply; break; }
					if (i === 9) this.phoneUssdReply = '（15 秒内未收到运营商回复）';
				}
			} catch (e) { this.phoneUssdReply = '失败：' + (e.message || e); }
			finally { this.phoneUssdBusy = false; }
		},
		phoneToggleLteBoost() {
			this.phoneLteBoost = !this.phoneLteBoost;
			localStorage.setItem('sa_phone_lte_boost', this.phoneLteBoost ? '1' : '0');
			this.phoneNotice = this.phoneLteBoost ? '4G 呼叫自动升 5G：开' : '4G 呼叫自动升 5G：关';
		},
		async phoneCallWithBoost(number, name) {
			/* 4G 呼叫自动升 5G（可选开关）：驻留 LTE 时先锁 NR5G 待注册再拨，
			 * 完成后恢复 AUTO；无 5G 覆盖或已升失败仍按原样拨出（对端可听回铃） */
			if (!this.phoneLteBoost) { await this.phoneCall(number, name); return; }
			let boosted = false;
			try {
				const mode = String(this.phoneNet.mode || '');
				const on5g = /NR5G|SA|NSA/.test(mode) || this.phoneNet.mode === '';
				if (!on5g) {
					this.phoneNotice = '4G 检测到：切换 5G 中（约 10 秒）…';
					await SimpleAdmin.Api.networkData({ action: 'save_settings', modePref: 'NR5G' });
					boosted = true;
					for (let i = 0; i < 12; i++) {
						await new Promise(r => setTimeout(r, 2000));
						await this.phoneLoadNet();
						if (/NR5G/.test(this.phoneNet.mode)) break;
					}
					this.phoneNotice = '';
				}
			} catch (_) { /* 切换失败按原样拨 */ }
			await this.phoneCall(number, name);
			if (boosted) {
				try {
					await new Promise(r => setTimeout(r, 3000));
					await SimpleAdmin.Api.networkData({ action: 'save_settings', modePref: 'AUTO' });
				} catch (_) { }
			}
		},
		phoneServiceNumbers() {
			const p = this.phoneNet.provider || '';
			/* 客服短号为运营商公开标准号码（非设备配置） */
			if (p.includes('移动')) return [{ n: '中国移动客服', t: '10086' }];
			if (p.includes('联通')) return [{ n: '中国联通客服', t: '10010' }];
			if (p.includes('电信')) return [{ n: '中国电信客服', t: '10001' }];
			if (p.includes('广电')) return [{ n: '中国广电客服', t: '10099' }];
			return [
				{ n: '移动客服', t: '10086' }, { n: '联通客服', t: '10010' },
				{ n: '电信客服', t: '10001' }, { n: '广电客服', t: '10099' }
			];
		},

		// ---- 拨号/通话控制 ----
		phoneCall(number, name) { return this.phoneCallDirect(number, name); },
		async phoneCallDirect(number, name) {
			const n = telKey(number);
			if (!n) return;
			if (!ACTIVE_STATES.includes(this.phoneState()) && this.phoneState() !== 'incoming_ringing') {
				if (this.phoneBusy) return;
				if (!this.phoneSecure()) {
					this.phoneError = '浏览器麦克风需要 HTTPS 访问（请用 https:// 打开本面板并信任证书）';
				}
				this.phoneBusy = true;
				try {
					await this.phoneApi('originate', { endpoint: 'browser', number: n });
					this.phoneTab = 'keypad';
					await this.phonePoll();
				} catch (e) {
					this.phoneError = this.phoneExplain(e);
				} finally { this.phoneBusy = false; }
			}
		},
		async phoneAnswer() {
			this.phoneBusy = true;
			try { await this.phoneApi('answer', { endpoint: 'browser' }); await this.phonePoll(); }
			catch (e) { this.phoneError = this.phoneExplain(e); }
			finally { this.phoneBusy = false; }
		},
		async phoneReject() {
			try { await this.phoneApi('reject', { endpoint: 'browser' }); } catch (e) { this.phoneError = this.phoneExplain(e); } 
			await this.phonePoll();
		},
		async phoneHangup() {
			this.phoneBusy = true;
			try { await this.phoneApi('hangup', { endpoint: 'browser' }); }
			catch (e) { this.phoneError = this.phoneExplain(e); }
			finally {
				this.phoneBusy = false;
				this.phoneMediaStop();
				await this.phonePoll();
			}
		},
		async phoneDtmf(digit) {
			this.phoneDtmfBuf = (this.phoneDtmfBuf.length >= 16 ? '' : this.phoneDtmfBuf) + digit;
			try { await this.phoneApi('send_dtmf', { endpoint: 'browser', digit: String(digit) }); }
			catch (e) { this.phoneError = this.phoneExplain(e); }
		},
		phoneToggleMute() {
			this.phoneMuted = !this.phoneMuted;
			const a = this.phoneAudio;
			if (a && a.node) a.node.port.postMessage({ type: 'mute', muted: this.phoneMuted });
			if (a && a.stream) a.stream.getAudioTracks().forEach(t => { t.enabled = !this.phoneMuted; });
		},
		phoneExplain(e) {
			const m = String(e.message || e);
			if (m.includes('invalid_state')) return '当前通话状态不允许此操作';
			if (m.includes('busy')) return '另一路通话占线';
			if (m.includes('invalid_number')) return '号码无效';
			if (m.includes('at_failed') || m.includes('NO CARRIER')) return '呼叫失败（模组/运营商拒绝，可能无 VoLTE 语音权限）';
			if (m.includes('invalid_endpoint')) return '语音端点不可用';
			if (m.includes('Not found') || m.includes('not found')) return 'voipd 服务未运行（未启用或未安装）';
			return m;
		},

		// ---- 媒体面 ----
		async phoneMediaStart() {
			if (this.phoneMediaState === 'open' || this.phoneMediaState === 'starting') return;
			if (!this.phoneSecure()) { this.phoneMediaState = 'error'; this.phoneMediaError = '非 HTTPS 上下文，无法使用麦克风'; return; }
			this.phoneMediaState = 'starting';
			this.phoneMediaError = '';
			if (!this.phoneHttpsBase) await this.phoneHttpsResolve();
			const mediaOrigin = this.phoneHttpsBase;
			try {
				await this.phonePoll();
				const snap = this.phoneStatus || {};
				const url = snap.media_url || '/qmodem-voip/media';
				const sessionId = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
				const tokenReply = await this.phoneApi('issue_media_token', {
					session_id: sessionId,
					call_revision: snap.revision != null ? snap.revision : 0,
					https_origin: mediaOrigin
				});
				let token = tokenReply.token || tokenReply.media_token || '';
				if (!token && /invalid_session/.test(String(tokenReply.error || ''))) {
					await this.phonePoll();
					const retry = await this.phoneApi('issue_media_token', {
						session_id: sessionId,
						call_revision: (this.phoneStatus || {}).revision != null ? this.phoneStatus.revision : 0,
						https_origin: mediaOrigin
					});
					token = retry.token || retry.media_token || '';
				}
				if (!token) throw new Error('未取得媒体令牌（' + (tokenReply.error || tokenReply.message || '未知') + '）');

				/* 原生 8k 协议：worklet 直发 8k/160 帧（路由器零重采样=QQ 镜像噪声根除），
				 * 硬件适配由浏览器内置高质量重采样完成 */
				const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 8000 });
				await ctx.resume();
				const stream = await navigator.mediaDevices.getUserMedia({
					audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }
				});
				await ctx.audioWorklet.addModule('js/pages/phone-worklet.js?v=jbuf7');
				const node = new AudioWorkletNode(ctx, 'sa-phone-audio', { numberOfInputs: 1, numberOfOutputs: 1 });
				ctx.createMediaStreamSource(stream).connect(node);
				node.connect(ctx.destination);

				/* media_url 是 voipd 广播的绝对地址（host=media_address，如
				 * 192.168.100.1），直连它不经认证且无反代；按上游 media.js 的做法
				 * 只取 pathname、以当前 https 页面源为 base（本部署=SA 8443 代理）。 */
				const endpoint = new URL(new URL(url, mediaOrigin).pathname, mediaOrigin);
				endpoint.protocol = 'wss:';
				endpoint.searchParams.set('session_id', sessionId);
				const ws = new WebSocket(endpoint.toString(), ['qmodem-voip', 'qmodem-voip-token.' + token]);
				ws.binaryType = 'arraybuffer';
				const handle = { ctx, stream, node, ws, sessionId };
				await new Promise((resolve, reject) => {
					const timer = setTimeout(() => reject(new Error('媒体连接超时')), 6000);
					ws.onopen = () => { clearTimeout(timer); resolve(); };
					ws.onerror = () => { clearTimeout(timer); reject(new Error('媒体 WSS 连接失败（证书未信任或 voipd 未就绪）')); };
				});
				ws.onmessage = (ev) => { if (ev.data instanceof ArrayBuffer) { handle.downFrames++; node.port.postMessage({ type: 'pcm', frame: ev.data }); } };
				ws.onclose = () => {
					if (this.phoneAudio === handle) {
						this.phoneAudio = null;
						if (ACTIVE_STATES.includes(this.phoneState())) {
							/* 通话中媒体断开（熄屏冻结/网络抖动）：自动重连而非干等 */
							this.phoneMediaState = 'error';
							this.phoneMediaError = '媒体连接中断，自动重连中…';
							const delay = Math.min(1000 * Math.pow(2, this.phoneMediaRetry), 8000);
							this.phoneMediaRetry++;
							if (this.phoneMediaRetry <= 5) {
								setTimeout(() => { if (this.phoneInCall() && this.phoneMediaState === 'error') this.phoneRestartMedia(); }, delay);
							} else this.phoneMediaError = '媒体连接中断（重连失败，请刷新页面）';
						} else {
							this.phoneMediaState = 'idle';
						}
					}
				};
				node.port.onmessage = (ev) => {
					if (ev.data && ev.data.type === 'pcm' && ws.readyState === WebSocket.OPEN)
						ws.send(ev.data.frame);
					else if (ev.data && ev.data.type === 'unsupported')
						this.phoneMediaError = '浏览器采样率不是 48kHz，音频异常';
				};
				this.phoneAudio = handle;
				handle.downFrames = 0;
				handle.lastFrames = 0;
				this.phoneMediaState = 'open';
				this.phoneMediaRetry = 0;
				this.phoneCallSeconds = 0;
				this.phoneTickTimer = setInterval(() => { this.phoneCallSeconds++; }, 1000);
				/* 通话保活三件套（BG199j）：
				 * 1) Wake Lock 防熄屏冻结页面（断 WS 停麦的主因），不支持则静默降级
				 * 2) 下行帧 watchdog：WS 假活/单侧停流 3s 自动重启媒体
				 * 3) 见 onclose 的自动重连 */
				this.phoneAcquireWakeLock();
				this.phoneStopWatchdog();
				this.phoneWatchTimer = setInterval(() => {
					const a = this.phoneAudio;
					if (!a || this.phoneMediaState !== 'open') return;
					if (a.downFrames === a.lastFrames) {
						this.phoneMediaError = '音频停滞，自动恢复中…';
						this.phoneRestartMedia();
					} else { a.lastFrames = a.downFrames; this.phoneMediaError = ''; }
				}, 3000);
			} catch (e) {
				this.phoneMediaState = 'error';
				this.phoneMediaError = String(e.message || e);
			}
		},
		async phoneAcquireWakeLock() {
			try {
				if (navigator.wakeLock && !this.phoneWakeLock) {
					this.phoneWakeLock = await navigator.wakeLock.request('screen');
					this.phoneWakeLock.addEventListener('release', () => { this.phoneWakeLock = null; });
				}
			} catch (_) { /* 不支持/无权限：静默降级（iOS<16.4/旧安卓） */ }
		},
		phoneReleaseWakeLock() {
			try { this.phoneWakeLock && this.phoneWakeLock.release(); } catch (_) {}
			this.phoneWakeLock = null;
		},
		phoneStopWatchdog() {
			if (this.phoneWatchTimer) { clearInterval(this.phoneWatchTimer); this.phoneWatchTimer = null; }
		},
		phoneRestartMedia() {
			/* 复用既有句柄清理但保留通话态，再重建媒体（watchdog/onclose/visibility 共用） */
			const keep = { retry: this.phoneMediaRetry };
			this.phoneMediaStop();
			this.phoneMediaRetry = keep.retry;
			if (this.phoneInCall()) this.phoneMediaStart();
		},
		phoneMediaStop() {
			const a = this.phoneAudio;
			this.phoneAudio = null;
			this.phoneMediaState = 'idle';
			this.phoneMediaError = '';
			this.phoneMuted = false;
			this.phoneDtmfBuf = '';
			if (!a) return;
			try { if (a.ws) { a.ws.onclose = null; a.ws.close(); } } catch (_) { }
			try { a.stream && a.stream.getTracks().forEach(t => t.stop()); } catch (_) { }
			try { a.node && a.node.disconnect(); } catch (_) { }
			try { a.ctx && a.ctx.close(); } catch (_) { }
			if (this.phoneTickTimer) { clearInterval(this.phoneTickTimer); this.phoneTickTimer = null; }
			this.phoneStopWatchdog();
			this.phoneReleaseWakeLock();
			this.phoneMediaRetry = 0;
		},

		// ---- 通讯录 ----
		phoneFilteredContacts() {
			const q = this.phoneContactSearch.trim().toLowerCase();
			const key = q.replace(/ /g, '');
			const list = this.phoneContacts.filter(c =>
				!q || c.name.toLowerCase().includes(q) || telKey(c.tel).includes(key));
			list.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
			return list;
		},
		phoneEditContact(c) {
			this.phoneContactEditor = c
				? { id: c.id, name: c.name, tel: c.tel, tag: c.tag || '', fav: !!c.fav }
				: { id: null, name: '', tel: '', tag: '', fav: false };
		},
		phoneSaveContact() {
			const e = this.phoneContactEditor;
			if (!e || !e.name.trim() || !telKey(e.tel)) { this.phoneError = '联系人和号码不能为空'; return; }
			if (e.id != null) {
				const c = this.phoneContacts.find(x => x.id === e.id);
				if (c) Object.assign(c, { name: e.name.trim(), tel: telKey(e.tel), tag: e.tag.trim(), fav: e.fav });
			} else {
				this.phoneContacts.push({ id: Date.now(), name: e.name.trim(), tel: telKey(e.tel), tag: e.tag.trim(), fav: e.fav });
			}
			saveContacts(this.phoneContacts);
			this.phoneContactEditor = null;
		},
		phoneDeleteContact(c) {
			if (!window.confirm('删除联系人 ' + c.name + '？')) return;
			this.phoneContacts = this.phoneContacts.filter(x => x.id !== c.id);
			saveContacts(this.phoneContacts);
		},
		phoneToggleFav(c) { c.fav = !c.fav; saveContacts(this.phoneContacts); },
		phoneFavContacts() { return this.phoneContacts.filter(c => c.fav); },
		phoneExportContacts() {
			const blob = new Blob([JSON.stringify(this.phoneContacts, null, 2)], { type: 'application/json' });
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = 'sa-contacts.json';
			a.click();
			URL.revokeObjectURL(a.href);
		},
		phoneImportContacts(ev) {
			const file = ev.target.files && ev.target.files[0];
			if (!file) return;
			const reader = new FileReader();
			reader.onload = () => {
				try {
					const arr = JSON.parse(String(reader.result));
					if (!Array.isArray(arr)) throw new Error('格式不对');
					const known = new Set(this.phoneContacts.map(c => telKey(c.tel)));
					let added = 0;
					arr.forEach(c => {
						if (c && c.name && telKey(c.tel) && !known.has(telKey(c.tel))) {
							this.phoneContacts.push({ id: Date.now() + added, name: String(c.name), tel: telKey(c.tel), tag: c.tag || '', fav: !!c.fav });
							added++;
						}
					});
					saveContacts(this.phoneContacts);
					this.phoneNotice = '导入完成：新增 ' + added + ' 条';
				} catch (e) { this.phoneError = '导入失败：' + (e.message || e); }
			};
			reader.readAsText(file);
			ev.target.value = '';
		},

		// ---- 通话记录 ----
		async phoneLoadHistory() {
			try {
				const h = await this.phoneApi('call_history');
				const list = Array.isArray(h) ? h : (h.history || h.calls || h.entries || []);
				this.phoneHistory = list.map(x => {
					const num = x.remote_number || x.number || '';
					const c = this.phoneContacts.find(ct => telKey(ct.tel) === telKey(num));
					return {
						number: num,
						name: (c && c.name) || x.name || '',
						direction: x.direction || x.type || 'outgoing',
						started: x.started_at || x.timestamp || x.time || 0,
						duration: x.duration_seconds != null ? x.duration_seconds : (x.duration || 0),
						missed: (x.direction || x.type) === 'missed' || x.missed === true
					};
				});
				this.phoneHistoryLoaded = true;
			} catch (e) { this.phoneError = this.phoneExplain(e); }
		},
		phoneFilteredHistory() {
			return this.phoneHistoryFilter === 'missed'
				? this.phoneHistory.filter(h => h.missed)
				: this.phoneHistory;
		},
		phoneHistoryWhen(h) {
			const t = Number(h.started);
			if (!t) return '';
			const d = new Date(t * (t > 1e12 ? 1 : 1000));
			const today = new Date();
			const same = d.toDateString() === today.toDateString();
			const hh = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
			return same ? hh : (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hh;
		},
		phoneDur(sec) {
			const s = Math.max(0, Number(sec) || 0);
			return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
		},

		// ---- 键盘 ----
		phoneKey(k) {
			if (this.phoneDial.length >= 24) return;
			this.phoneDial += k;
		},
		phoneDel() { this.phoneDial = this.phoneDial.slice(0, -1); },
		phoneDialDisplay() { return this.phoneDial ? fmtNumber(this.phoneDial) : ''; },
		phoneDialDisplayOr(n) { return fmtNumber(n); },
		phoneCallLabel() {
			const s = this.phoneState();
			const dur = this.phoneDur(this.phoneCallSeconds);
			if (s === 'incoming_ringing') return '来电振铃…';
			if (s === 'outgoing_setup') return '正在呼叫…';
			if (s === 'early_media') return '接续中… ' + dur;
			if (s === 'active') return '通话中 ' + dur;
			if (s === 'terminating') return '结束中…';
			if (s === 'recovering') return '状态恢复中…';
			if (s === 'fault') return '通话异常';
			if (s === 'disabled') return '语音服务未启用';
			return '';
		},
		phoneKeyRows() {
			return [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
				['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', ''], ['0', '+'], ['#', '']];
		}
	};
}
if (window.SimpleAdminSpaMode) {
	(window.SimpleAdmin.Pages = window.SimpleAdmin.Pages || {}).phone = fetchPhone;
} else {
	mountSimpleAdminVueApp(fetchPhone);
}
