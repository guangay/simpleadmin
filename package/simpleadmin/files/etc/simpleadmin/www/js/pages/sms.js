function fetchSMS() {
  return {
    smsEnabled: false,
    clearAllBusy: false,
    async confirmClearDeviceSms() {
      // qmodem-smsd 账本为主 + SIM 中转残留一并清空（本地发送记录保留）
      if (!confirm('此操作将删除设备短信库（含 SIM 中转残留）的所有短信（含未读），且无法撤销。确定继续吗？')) return;
      if (!confirm('再次确认：真的要清空设备上的全部短信吗？')) return;
      this.clearAllBusy = true;
      try {
        await SimpleAdmin.Api.smsData({ action: 'delete_all' });
        this.showNotification('设备短信已清空', 'success');
        await this.init();
      } catch (error) {
        this.showNotification('清空失败：' + (error.message || error), 'danger');
      } finally {
        this.clearAllBusy = false;
      }
    },
    smsView: 'inbox',
    selectSmsView(view) {
      if (!['inbox','compose','forwarding'].includes(view)) return;
      this.smsView=view;
      document.querySelector('[data-page="sms"]').dataset.smsView=view;
      this.closeMessageDetail();
      if (view==='inbox') { this.requestSMS(); this.startSMSAutoRefresh(); } else this.stopSMSAutoRefresh();
      window.dispatchEvent(new CustomEvent('simpleadmin:sms-view',{detail:{view}}));
    },
    deleteAfterDay: false,
    smsSettingsLoaded: false,
    smsSettingsLoading: false,
    smsSettingsSaving: false,
    smsSettingsMessage: '',
    pendingDeletes: 0,
    async loadSmsSettings() {
      if (this.smsSettingsLoading || this.smsSettingsSaving) return;
      this.smsSettingsLoading=true;
      try {
        const response=await SimpleAdmin.Api.request('/api/forwarding');const data=await response.json();
        if (!response.ok) throw new Error(data.error || '读取设置失败');
        this.smsEnabled=data.sms_enabled;this.deleteAfterDay=data.delete_after_day;this.pendingDeletes=data.cleanup.pending;this.smsSettingsLoaded=true;
        this.smsSettingsMessage=data.cleanup.clock_paused ? SimpleAdmin.Lang.t('系统时间异常，自动删除已延后') : (data.cleanup.error || '');
        if (this.smsEnabled) {await this.requestSMS({force:true});this.startSMSAutoRefresh();} else {this.stopSMSAutoRefresh();this.clearData();}
      } catch(error) {this.smsSettingsMessage=error.message;} finally {this.smsSettingsLoading=false;}
    },
    async saveSmsSettings() {
      this.smsSettingsSaving=true;this.smsSettingsMessage='';
      try {
        const response=await SimpleAdmin.Api.request('/api/sms/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:this.smsEnabled,delete_after_day:this.deleteAfterDay})});const data=await response.json();
        if (!response.ok) throw new Error(data.error || '保存失败');
        this.smsEnabled=data.sms_enabled;this.deleteAfterDay=data.delete_after_day;this.pendingDeletes=data.cleanup.pending;
        this.smsSettingsMessage=SimpleAdmin.Lang.t('已保存');
        window.dispatchEvent(new CustomEvent('simpleadmin:sms-settings'));
        if (this.smsEnabled) {await this.requestSMS({force:true});this.startSMSAutoRefresh();} else {this.stopSMSAutoRefresh();this.clearData();}
      } catch(error) {this.smsSettingsMessage=error.message;} finally {this.smsSettingsSaving=false;}
    },
    isLoading: false,
    messages: [],
    senders: [],
    dates: [],
    selectedMessages: [],
    phoneNumber: '',
    messageToSend: '',
    messageIndices: [],
    serviceCenters: [],
    activeMessageIndex: null,
    smsDetailGlobalHandlersBound: false,
    smsAutoRefreshTimer: null,
    smsAutoRefreshInFlight: false,
    smsAutoRefreshIntervalMs: 5000,
    smsListSignature: '',
    smsIndexSignature: '',
    smsPendingData: null,
    smsPendingIndexSignature: '',
    smsPendingListSignature: '',
    smsPendingStableCount: 0,
    smsPendingFirstSeenAt: 0,
    smsStablePollsRequired: 2,
    sentList: [],
    activeConversation: "",
    chatInput: "",
    newChatNumber: "",
    chatSending: false,
    smsPendingMaxWaitMs: 15000,

    clearData() {
      this.messages = [];
      this.senders = [];
      this.dates = [];
      this.selectedMessages = [];
      this.messageIndices = [];
      this.smsListSignature = '';
      this.smsIndexSignature = '';
      this.resetSMSPendingRefresh();
      this.activeMessageIndex = null;
      this.setMessageDetailOpenState(false);
      this.syncSelectAllCheckbox();
    },

    requestSMS(options = {}) {
      if (!this.smsEnabled) return Promise.resolve();
      const silent = options.silent === true;
      const params = { action: 'list' };
      if (options.force === true) params.force = '1';
      if (!silent) this.isLoading = true;
      return SimpleAdmin.Api.smsData(params)
        .then((data) => {
          this.applySMSData(data, {
            keepDetail: options.keepDetail === true,
            keepSelection: options.keepSelection === true
          });
        })
        .finally(() => {
          if (!silent) this.isLoading = false;
        });
    },

    normalizePeerNumber(raw) {
      const s = String(raw || '');
      // 字母发送方（运营商名/服务名，国内外皆常见）：保留字母小写归一，
      // 不与纯数字形态互通（否则 "CMCC"/"10086" 之类会互相误并）；
      // 含字母的键与纯数字键天然不冲突，无需前缀
      if (/[a-zA-Z]/.test(s)) return s.toLowerCase().replace(/[^a-z0-9]/g, '');
      // 纯数字：去掉 + 与一切分隔符，统一到裸数字形态
      return s.replace(/[^0-9]/g, '');
    },
    /* 同一号码的等价判定（国际通用，不写死国家码）：
     * 同一号码常以多形态共存——E.164 带 +（+8619807222534）、不带 + 的国际
     * 形态（8619807222534）、本地形态（19807222534）、乃至他国组合
     * （+14155551234 / 4155551234）。规则：纯数字且双方均 >6 位时，
     * 互为后缀即视为同一号码（本地形态必然是国际形态的真后缀）；
     * 短号（≤6 位，各国服务号）与字母名严格精确匹配，绝不后缀归并。 */
    peerNumbersMatch(a, b) {
      if (a === b) return true;
      if (!a || !b) return false;
      const numeric = v => /^[0-9]+$/.test(v);
      if (!numeric(a) || !numeric(b)) return false;
      // 后缀归并的两道闸（复审实测教训：7 位阈值下 "+4479111234567" 与
      // "079111234567" 都被 7 位号 "1234567" 吞并——三号一会话）：
      // ①短侧至少 9 位（各国主号位长量级；7-8 位碎号与任何长号都不归并）
      // ②长度差 ≤5（E.164 与本地形态之差=国家码 1-3 位(+中继前缀 0)，超过必非同号）
      if (a.length < 9 || b.length < 9) return false;
      if (Math.abs(a.length - b.length) > 5) return false;
      return a.endsWith(b) || b.endsWith(a);
    },
    smsConversations() {
      // 分组用 peerNumbersMatch 后缀归并（见其注释），组内保留全部原始形态：
      // sendNumber 取带 + 的国际形态优先（发短信给后端归一最稳，国外裸号码
      // 无 + 时后端无法推断国家码）；numbers 供删除会话时逐形态清理双端账本
      const groups = [];
      const push = (number, item) => {
        const key = this.normalizePeerNumber(number);
        if (!key) return;
        let group = groups.find(g => this.peerNumbersMatch(g.key, key));
        if (!group) { group = { key, raws: new Set(), items: [] }; groups.push(group); }
        group.raws.add(String(number));
        group.raws.add(key);
        group.items.push(item);
      };
      (this.messages || []).forEach((m, i) => {
        push(m.sender, { dir: 'in', text: m.text, date: m.date instanceof Date ? m.date : new Date(NaN), indices: m.indices || [], storage: m.storage || 'ME', idx: i });
      });
      (this.sentList || []).forEach((r) => {
        const d = new Date(Number(r.t) || NaN);
        push(r.n, { dir: 'out', text: r.x || '', date: Number.isNaN(d.getTime()) ? new Date(NaN) : d, indices: [], storage: '本地' });
      });
      const today = new Date().toDateString();
      const fmtTime = (d) => Number.isNaN(d.getTime()) ? '' : (d.toDateString() === today ? d.toTimeString().slice(0,5) : (d.getMonth()+1)+'/'+d.getDate());
      return groups.map((g) => {
        g.items.sort((a, b) => (a.date.getTime() || 0) - (b.date.getTime() || 0));
        const last = g.items[g.items.length - 1];
        const raws = [...g.raws];
        const sendNumber = raws.find(n => n.startsWith('+')) || raws.slice().sort((a, b) => b.length - a.length)[0] || g.key;
        return {
          number: g.key,
          sendNumber,
          numbers: raws,
          items: g.items,
          lastText: (last ? (last.text || '') : '').slice(0, 40),
          lastTimeText: last ? fmtTime(last.date) : ''
        };
      }).sort((a, b) => {
        const at = (a.items[a.items.length-1] && a.items[a.items.length-1].date.getTime()) || 0;
        const bt = (b.items[b.items.length-1] && b.items[b.items.length-1].date.getTime()) || 0;
        return bt - at;
      });
    },
    smsActiveMessages() {
      const conv = this.smsConversations().find((c) => c.number === this.activeConversation);
      return conv ? conv.items : [];
    },
    exportChats() {
      const data = { exportedAt: new Date().toISOString(), device: 'SimpleAdmin', conversations: this.smsConversations() };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'sms-conversations-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
    },
    openConversation(number) {
      this.activeConversation = this.normalizePeerNumber(number);
    },
    async sendChat() {
      const text = (this.chatInput || '').trim();
      if (!text || !this.activeConversation || this.chatSending) return;
      this.chatSending = true;
      // 收件人取会话的国际形态（带 + 优先）——国外号码无 + 时后端无法从
      // IMSI 推断正确国家码，必须用账本里出现过的 E.164 原形态；
      // 勿再归一化剥 +（国外裸号码会被按本机 IMSI 补错国家码）
      const conv = this.smsConversations().find(c => c.number === this.activeConversation);
      const number = String((conv && conv.sendNumber) || this.activeConversation).replace(/[\s\-()]/g, '');
      try {
        // smsData (postJSON) 已返回解析后的对象,不能再调 res.json()
        const data = await SimpleAdmin.Api.smsData({ action: 'send', number, message: text });
        if (!data || data.ok === false || data.error) {
          alert('发送失败：' + ((data && (data.error || data.response)) || '未知错误'));
          return;
        }
        this.showNotification('短信发送成功！', 'success');
        this.chatInput = '';
        this.sentList.push({ n: number, t: Date.now(), x: text, s: data.segments || 1 });
      } catch (e) {
        alert('发送失败：' + (e && e.message ? e.message : e));
      } finally {
        this.chatSending = false;
      }
    },
    async deleteConversation(number) {
      const key = this.normalizePeerNumber(number);
      const conv = this.smsConversations().find((c) => c.number === key);
      if (!conv) return;
      const inbound = conv.items.filter((m) => m.dir === 'in' && m.indices.length);
      if (!window.confirm('删除与 ' + key + ' 的会话（' + conv.items.length + ' 条，其中 ' + inbound.length + ' 条在设备短信库）？本地发送记录将一并清除。')) return;
      const banks = new Map();
      inbound.forEach((m) => {
        const storage = m.storage || 'ME';
        if (!banks.has(storage)) banks.set(storage, []);
        banks.get(storage).push(...m.indices);
      });
      for (const [storage, indices] of banks) {
        if (!indices.length) continue;
        try { await SimpleAdmin.Api.smsData({ action: 'delete_indices', storage, indices: indices.join(',') }); }
        catch (e) { console.warn('删除模组短信失败：', e); }
      }
      // 同步清除后端持久发送记录，否则下一轮轮询会把会话"复活"成仅出站。
      // 后端按纯数字精确匹配，须逐原始形态清理（+86…/86…/本地… 各是一行）
      for (const form of (conv.numbers || [key])) {
        try { await SimpleAdmin.Api.smsData({ action: 'delete_sent', number: form }); }
        catch (e) { console.warn('清理发送记录失败：', e); }
      }
      this.sentList = this.sentList.filter((r) => this.normalizePeerNumber(r.n) !== key);
      if (this.activeConversation === key) this.activeConversation = '';
      this.showNotification('会话已删除', 'success');
    },
    applySMSData(data, options = {}) {
      if (data.disabled) {this.smsEnabled=false;this.stopSMSAutoRefresh();this.clearData();return;}
      const activeKey = options.keepDetail === true ? this.currentMessageKey(this.activeMessageIndex) : '';
      const selectedKeys = options.keepSelection === true
        ? this.selectedMessages.map((index) => this.currentMessageKey(index)).filter(Boolean)
        : [];

      this.messages = [];
      this.senders = [];
      this.dates = [];
      this.selectedMessages = [];
      this.messageIndices = [];
      this.serviceCenters = data.serviceCenters || [];
      this.sentList = Array.isArray(data.sent) ? data.sent.slice() : [];
      (data.messages || []).forEach((msg) => {
        // qmodem-smsd 账本带 unix ts（秒）优先；旧 AT 路径无 ts 走 27.005 日期串
        const date = msg.ts ? new Date(Number(msg.ts) * 1000) : (msg.date ? this.parseCustomDate(String(msg.date)) : new Date(NaN));
        this.pushSMSMessage(
          msg.sender || '',
          Number.isNaN(date.getTime()) ? new Date() : date,
          msg.text || '',
          msg.indices || [],
          Array.isArray(msg.textLines) ? msg.textLines : [],
          msg.storage || 'ME'
        );
      });

      this.smsListSignature = this.makeSMSListSignature(data);
      this.smsIndexSignature = this.makeSMSIndexSignature(data);
      this.resetSMSPendingRefresh();
      this.restoreSelectionByKeys(selectedKeys);
      this.restoreActiveMessageByKey(activeKey);
      this.syncSelectAllCheckbox();
    },

    pushSMSMessage(sender, date, text, indices, textLines = [], storage = 'ME') {
      const normalizedText = this.normalizeMessageText(text);
      const lines = this.normalizeMessageLines(normalizedText, textLines);
      this.messageIndices.push(indices);
      this.senders.push(sender);
      this.dates.push(this.formatDate(date));
      this.messages.push({ text: normalizedText, lines, sender, date, indices, storage });
    },

    normalizeMessageText(text) {
      return String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/[\v\f\u0085\u2028\u2029]/g, '\n')
        .replace(/\\r\\n/g, '\n')
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\n');
    },

    normalizeMessageLines(text, textLines = []) {
      if (Array.isArray(textLines) && textLines.length > 0) {
        const lines = [];
        textLines.forEach((line) => {
          this.normalizeMessageText(line).split('\n').forEach((part) => {
            lines.push(part);
          });
        });
        return lines;
      }
      return this.normalizeMessageText(text).split('\n');
    },

    getMessagePreview(message) {
      const text = Array.isArray(message?.lines) ? message.lines.join(' ') : message?.text;
      return String(text || '').replace(/\s+/g, ' ').trim() || '（无内容）';
    },

    makeSMSListSignature(data) {
      return JSON.stringify((data.messages || []).map((msg) => [
        msg.storage || 'ME',
        msg.sender || '',
        msg.date || '',
        msg.text || '',
        Array.isArray(msg.indices) ? msg.indices.join(',') : '',
        Array.isArray(msg.textLines) ? msg.textLines.join('\n') : ''
      ]));
    },

    makeSMSIndexSignature(data) {
      const indices = [];
      (data.messages || []).forEach((msg) => {
        if (!Array.isArray(msg.indices)) return;
        msg.indices.forEach((index) => {
          const n = Number(index);
          if (Number.isFinite(n)) indices.push(`${msg.storage || 'ME'}:${n}`);
        });
      });
      indices.sort();
      return indices.join(',');
    },

    hasIncompleteMultipartSMS(data) {
      return (data.messages || []).some((msg) => {
        const total = Number(msg.concatTotal || 0);
        if (!Number.isFinite(total) || total <= 1) return false;
        const indices = Array.isArray(msg.indices) ? msg.indices : [];
        return indices.length < total;
      });
    },

    resetSMSPendingRefresh() {
      this.smsPendingData = null;
      this.smsPendingIndexSignature = '';
      this.smsPendingListSignature = '';
      this.smsPendingStableCount = 0;
      this.smsPendingFirstSeenAt = 0;
    },

    messageKey(message, sender, dateText) {
      if (!message) return '';
      const indices = Array.isArray(message.indices) ? message.indices.join(',') : '';
      return [message.storage || 'ME', indices, sender || message.sender || '', dateText || '', message.text || ''].join('|');
    },

    currentMessageKey(index) {
      if (index === null || index === undefined) return '';
      return this.messageKey(this.messages[index], this.senders[index], this.dates[index]);
    },

    restoreSelectionByKeys(keys) {
      if (!Array.isArray(keys) || keys.length === 0) return;
      const keySet = new Set(keys);
      this.selectedMessages = this.messages
        .map((_, index) => index)
        .filter((index) => keySet.has(this.currentMessageKey(index)));
    },

    restoreActiveMessageByKey(key) {
      if (!key) {
        this.activeMessageIndex = null;
        this.setMessageDetailOpenState(false);
        return;
      }
      const nextIndex = this.messages.findIndex((_, index) => this.currentMessageKey(index) === key);
      if (nextIndex >= 0) {
        this.activeMessageIndex = nextIndex;
        this.setMessageDetailOpenState(true);
        return;
      }
      this.activeMessageIndex = null;
      this.setMessageDetailOpenState(false);
    },

    syncSelectAllCheckbox() {
      const selectAllCheckbox = document.getElementById('selectAllCheckbox');
      if (!selectAllCheckbox) return;
      const hasMessages = this.messages.length > 0;
      selectAllCheckbox.checked = hasMessages && this.selectedMessages.length === this.messages.length;
    },

    bindMessageDetailGlobalHandlers() {
      if (this.smsDetailGlobalHandlersBound) return;
      this.smsDetailGlobalHandlersBound = true;
      window.addEventListener('simpleadmin:page-changed', (event) => {
        if (event?.detail?.page === 'sms') {
          this.loadSmsSettings();
          return;
        }
        this.stopSMSAutoRefresh();
        this.closeMessageDetail();
      });
      window.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && this.activeMessageIndex !== null) {
          this.closeMessageDetail();
        }
      });
    },

    isSMSPageActive() {
      const page = document.querySelector('.sa-page[data-page="sms"]');
      return !!page && page.classList.contains('active') && this.smsView==='inbox';
    },

    startSMSAutoRefresh() {
      if (!this.smsEnabled || !this.smsSettingsLoaded) return;
      if (!this.isSMSPageActive()) return;
      if (this.smsAutoRefreshTimer) return;
      this.smsAutoRefreshTimer = setInterval(() => {
        this.autoRefreshSMS();
      }, this.smsAutoRefreshIntervalMs);
    },

    stopSMSAutoRefresh() {
      if (this.smsAutoRefreshTimer) {
        clearInterval(this.smsAutoRefreshTimer);
        this.smsAutoRefreshTimer = null;
      }
      this.smsAutoRefreshInFlight = false;
      this.resetSMSPendingRefresh();
    },

    autoRefreshSMS() {
      if (!this.isSMSPageActive() || !this.smsEnabled) {
        this.stopSMSAutoRefresh();
        return;
      }
      if (this.smsAutoRefreshInFlight || this.isLoading) return;
      this.smsAutoRefreshInFlight = true;
      SimpleAdmin.Api.smsData({ action: 'list_meta', force: '1' })
        .then((data) => {
          if (data.disabled) {this.smsEnabled=false;this.stopSMSAutoRefresh();this.clearData();return null;}
          if (!this.isSMSPageActive()) return null;
          return this.handlePolledSMSMeta(data);
        })
        .catch(() => {
          // Keep the timer alive; the next interval can retry.
        })
        .finally(() => {
          this.smsAutoRefreshInFlight = false;
        });
    },

    makeSMSMetaSignature(data) {
      return JSON.stringify((data.messages || []).map((msg) => [
        msg.storage || 'ME',
        msg.sender || '',
        msg.date || '',
        Array.isArray(msg.indices) ? msg.indices.join(',') : '',
        msg.concatTotal || '',
        msg.concatRef || '',
        msg.concatSeq || ''
      ]));
    },

    handlePolledSMSMeta(data) {
      const indexSignature = this.makeSMSIndexSignature(data);
      if (indexSignature === this.smsIndexSignature) {
        this.resetSMSPendingRefresh();
        return null;
      }

      const metaSignature = this.makeSMSMetaSignature(data);
      const now = Date.now();
      if (indexSignature === this.smsPendingIndexSignature && metaSignature === this.smsPendingListSignature) {
        this.smsPendingStableCount += 1;
      } else {
        this.smsPendingData = data;
        this.smsPendingIndexSignature = indexSignature;
        this.smsPendingListSignature = metaSignature;
        this.smsPendingStableCount = 1;
        this.smsPendingFirstSeenAt = now;
      }

      const waited = now - this.smsPendingFirstSeenAt;
      const incompleteMultipart = this.hasIncompleteMultipartSMS(this.smsPendingData || data);
      if (incompleteMultipart && waited < this.smsPendingMaxWaitMs) return null;
      if (this.smsPendingStableCount < this.smsStablePollsRequired && waited < this.smsPendingMaxWaitMs) return null;

      return this.fetchStableSMSList(this.smsPendingIndexSignature);
    },

    fetchStableSMSList(expectedIndexSignature) {
      return SimpleAdmin.Api.smsData({ action: 'list', force: '1' })
        .then((data) => {
          if (!this.isSMSPageActive()) return;
          const indexSignature = this.makeSMSIndexSignature(data);
          if (indexSignature === this.smsIndexSignature) {
            this.resetSMSPendingRefresh();
            return;
          }
          if (expectedIndexSignature && indexSignature !== expectedIndexSignature) {
            this.smsPendingData = data;
            this.smsPendingIndexSignature = indexSignature;
            this.smsPendingListSignature = this.makeSMSMetaSignature(data);
            this.smsPendingStableCount = 1;
            this.smsPendingFirstSeenAt = Date.now();
            return;
          }
          this.applySMSData(data, { keepDetail: true, keepSelection: true });
        });
    },

    setMessageDetailOpenState(isOpen) {
      if (document.body) {
        document.body.classList.toggle('sa-sms-detail-open', isOpen);
      }
    },

    openMessageDetail(index) {
      this.activeMessageIndex = index;
      this.setMessageDetailOpenState(true);
      if (typeof this.$nextTick === 'function') {
        this.$nextTick(() => {
          const closeButton = document.querySelector('.sa-sms-detail-modal .btn-close');
          if (closeButton) closeButton.focus({ preventScroll: true });
        });
      }
    },

    closeMessageDetail() {
      this.activeMessageIndex = null;
      this.setMessageDetailOpenState(false);
    },

    parseCustomDate(dateStr) {
      // 3GPP TS 27.005 / SCTS: "yy/mm/dd,hh:mm:ss±zz"——zz 为时区（15 分钟单位，
      // +32=UTC+8），时间字段是发件方本地时间。UTC = 本地字段 − 时区偏移；
      // 无时区标记时按字段原值当 UTC（后端恒输出标记，此分支仅兜底）。
      const m = String(dateStr || '').match(/^(\d{2})\/(\d{2})\/(\d{2}),(\d{2}):(\d{2}):(\d{2})(?:([+-])(\d{1,2}))?$/);
      if (!m) return new Date(NaN);
      const [, yy, mm, dd, hh, mi, ss, sign, q] = m;
      let ms = Date.UTC(2000 + Number(yy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss));
      if (sign && q) {
        ms -= Number(q) * 15 * 60000 * (sign === '+' ? 1 : -1);
      }
      return new Date(ms);
    },

    formatDate(date) {
      // 本地时区 getter：parseCustomDate 已产出真 UTC 时刻，展示须按浏览器
      // 本地时间（此前 parse/format 双双用 UTC 恰好抵消，parse 修正后须联动）
      const year = date.getFullYear() - 2000;
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      const hour = date.getHours().toString().padStart(2, '0');
      const minute = date.getMinutes().toString().padStart(2, '0');
      const second = date.getSeconds().toString().padStart(2, '0');
      return `${day}/${month}/${year},${hour}:${minute}:${second}`;
    },

    async deleteSelectedSMS() {
      if (this.selectedMessages.length === 0) {
        console.warn('没有选中的短信');
        return;
      }

      if (!this.messageIndices || this.messageIndices.length === 0) {
        console.error('短信索引未正确初始化或为空');
        return;
      }

      const isAllSelected = this.selectedMessages.length === this.messages.length;
      if (isAllSelected) {
        this.confirmClearDeviceSms();
        return;
      }

      const banks = new Map();
      this.selectedMessages.forEach((index) => {
        const message = this.messages[index];
        const storage = message.storage || 'ME';
        if (!banks.has(storage)) banks.set(storage, []);
        banks.get(storage).push(...message.indices);
      });

      if (banks.size === 0) {
        console.warn('没有有效的短信索引');
        return;
      }

      try {
        for (const [storage, indices] of banks) {
          await SimpleAdmin.Api.smsData({ action: 'delete_indices', storage, indices: indices.join(',') });
        }
      } finally {
        this.selectedMessages = [];
        this.requestSMS({ force: true });
      }
    },

    async sendSMS() {
      if (!this.phoneNumber || !this.messageToSend) {
        this.showNotification('号码或内容不能为空', 'warning');
        return;
      }

      try {
        const simStatus = await SimpleAdmin.Api.smsData({ action: 'sim_status' });
        if (!simStatus.inserted) {
          this.showNotification('未检测到 SIM 卡', 'danger');
          return;
        }
      } catch { }

      try {
        const result = await SimpleAdmin.Api.smsData({
          action: 'send',
          number: this.phoneNumber,
          message: this.messageToSend
        });
        if (result.ok) {
          this.showNotification('短信发送成功！', 'success');
          return;
        }
        this.showNotification(`短信发送失败：${result.error || '未知错误'}`, 'danger');
      } catch (error) {
        this.showNotification(`短信发送失败：${error?.message || '网络错误'}`, 'danger');
      }
    },

    showNotification(message, type = 'info') {
      const n = document.getElementById('notification');
      const translated = SimpleAdmin.Lang ? SimpleAdmin.Lang.t(message) : message;
      n.innerText = translated;
      n.dataset.simpleadminI18nKey = message;
      n.className = `alert alert-${type}`;
      n.style.display = 'block';
      setTimeout(() => { n.style.display = 'none'; }, 3000);
    },

    init() {
      this.bindMessageDetailGlobalHandlers();
      this.clearData();
      this.loadSmsSettings();
    },

    toggleAll(event) {
      this.selectedMessages = event.target.checked ? this.messages.map((_, index) => index) : [];
      this.syncSelectAllCheckbox();
    }
  };
}

if (window.SimpleAdminSpaMode) {
  (window.SimpleAdmin.Pages = window.SimpleAdmin.Pages || {}).sms = fetchSMS;
} else {
  mountSimpleAdminVueApp(fetchSMS);
}
