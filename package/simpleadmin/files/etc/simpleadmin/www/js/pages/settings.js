function simpleSettings() {
      return {
        noAuth: false,
        isLoading: false,
        showSuccess: false,
        showError: false,
        isClean: true,
        showModal: false,
        showImeiModal: false,
        isRebooting: false,
        atcmd: "",
        sleepModeEnabled: "-",
        sleepBusy: false,
        fetchATCommand: "",
        countdown: 0,
        atCommandResponse: "",
        ttldata: null,
          pinUnlockInput: "", pinOldInput: "", pinNewInput: "",
          simlockPinInput: "", smscInput: "", currentSmsc: "", airplaneState: "",
        ttlvalue: 0,
        ttlStatus: false,
        newTTL: null,
        ipPassMode: "未指定",
        ipPassStatus: false,
        usbNetMode: "未指定",
        currentUsbNetMode: "未知",
        imei: "-",
        newImei: "",
        lanIpStart: "",  // 初始化 LAN IP 起始地址
        lanIpEnd: "",    // 初始化 LAN IP 结束地址
        lanGwIp: "",     // 初始化 网关 IP 地址
        isSavingLANIP: false,
        lanIpSaveSuccess: false,
        lanIpSaveSuccessTimer: null,
        DNSV6ProxyStatus: true,
        DNSV4ProxyStatus: true,
        dmzMode: "0",
        dmzIP: "",
        isRebooted: true,
        language: SimpleAdmin.Lang ? SimpleAdmin.Lang.getCurrentLanguage() : "zh-CN",
        isSavingLanguage: false,
        languageSaveMessage: "",
        webUsername: "",
        webHttpPort: 80,
        webHttpEnabled: true,
        webuiCurrentPassword: "",
        isSavingWebui: false,
        webuiSaveMessage: "",
        webuiNewUrl: "",
        currentPassword: "",
        newPassword: "",
        confirmPassword: "",
        isSavingPassword: false,
        passwordSaveMessage: "",
        currentRootPassword: "",
        newRootPassword: "",
        confirmRootPassword: "",
        isSavingRootPassword: false,
        rootPasswordSaveMessage: "",
        rebootCountdownTimer: null,
        // AT 终端：常用命令快捷填入 + 自定义收藏（QModem 调试页对齐，localStorage 持久化）
        atQuickCommands: [
          'ATI', 'AT+CPIN?', 'AT+CSQ', 'AT+COPS?', 'AT+CGDCONT?', 'AT+CGPADDR',
          'AT+CGSN', 'AT+CBC', 'AT+CFUN?', 'AT+QNWINFO', 'AT+QCAINFO', 'AT+QTEMP',
          'AT+QSIMSTAT?', 'AT+CIMI', 'AT+ICCID', 'AT+QRSRP'
        ],
        atFavorites: [],
        ttlMessage: '',

        t(key) {
          return SimpleAdmin.Lang ? SimpleAdmin.Lang.t(key) : key;
        },

        fetchLanguageSetting() {
          if (!SimpleAdmin.Lang) return Promise.resolve(this.language);
          return SimpleAdmin.Lang.load().then((language) => {
            this.language = language;
            return language;
          });
        },

        resolveDmzMode(mode, ip) {
          const currentMode = String(mode || '').trim();
          const currentIp = String(ip || '').trim();
          if (currentIp && currentIp !== '-') {
            return '1';
          }
          return currentMode === '1' ? '1' : '0';
        },

        saveLanguageSetting() {
          if (!SimpleAdmin.Lang) return;
          this.isSavingLanguage = true;
          this.languageSaveMessage = "";
          SimpleAdmin.Lang.setLanguage(this.language)
            .then((language) => {
              this.language = language;
              this.languageSaveMessage = this.t("已保存");
              setTimeout(() => {
                this.languageSaveMessage = "";
              }, 3000);
            })
            .catch((error) => {
              console.error("保存语言设置失败：", error);
              this.languageSaveMessage = this.t("保存失败");
            })
            .finally(() => {
              this.isSavingLanguage = false;
            });
        },

        async changeRootPassword() {
          if(this.isSavingRootPassword) return;
          this.rootPasswordSaveMessage = '';
          if(!this.currentRootPassword || !this.newRootPassword || this.newRootPassword !== this.confirmRootPassword) {
            this.rootPasswordSaveMessage = '请填写当前 root 密码，并确认两次新密码一致'; return;
          }
          this.isSavingRootPassword = true;
          const controller = new AbortController();
          const deadline = setTimeout(() => controller.abort(), 40000);
          try {
            const response = await fetch('/api/set_root_password', {method:'POST', signal:controller.signal, headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({current_password:this.currentRootPassword,new_password:this.newRootPassword,confirm_password:this.confirmRootPassword})});
            if(response.status === 401) {window.location.replace('/login.html');return;}
            const data = await response.json();
            if(!response.ok) throw new Error(data.error || '保存失败');
            this.currentRootPassword = this.newRootPassword = this.confirmRootPassword = '';
            window.location.replace('/login.html');
          } catch(error) {this.rootPasswordSaveMessage = error.name === 'AbortError' ? '请求超时，请确认设备密码与挂载状态' : error.message;}
          finally {clearTimeout(deadline);this.isSavingRootPassword=false;}
        },

        async fetchWebuiSetting() {
          try {
            const response = await fetch('/api/webui_settings', {cache:'no-store'});
            if (!response.ok) throw new Error(this.t("读取 WebUI 设置失败"));
            const data = await response.json();
            this.webUsername = data.username;
            this.webHttpPort = data.http_port;
            this.webHttpEnabled = data.http_enabled;
            this.noAuth = data.no_auth === true;
          } catch(error) { this.webuiSaveMessage = error.message; }
        },

        async saveWebuiPort() {
          if (this.isSavingWebui) return;
          this.webuiSaveMessage = ""; this.webuiNewUrl = "";
          if ((!this.webuiCurrentPassword && !this.noAuth) || !/^[1-9][0-9]{0,4}$/.test(String(this.webHttpPort)) || Number(this.webHttpPort) > 65535) {
            this.webuiSaveMessage = this.noAuth ? this.t("请填写 1–65535 的端口") : this.t("请填写当前 Web 密码和 1–65535 的端口"); return;
          }
          this.isSavingWebui = true;
          const controller = new AbortController();
          const deadline = setTimeout(() => controller.abort(), 40000);
          try {
            const response = await fetch('/api/set_webui_port', {method:'POST',signal:controller.signal,
              headers:{'Content-Type':'application/x-www-form-urlencoded'},
              body:new URLSearchParams({current_password:this.webuiCurrentPassword,http_port:String(this.webHttpPort)})});
            const data = await response.json();
            if (!response.ok) {
              const errors = {"current password incorrect":"当前密码不正确","HTTP port is already in use or unavailable":"端口已被占用或不可用，原配置保持不变"};
              throw new Error(this.t(errors[data.error] || data.error || "保存失败"));
            }
            this.webuiCurrentPassword = "";
            this.webuiSaveMessage = this.t(data.changed ? "端口已保存并生效，无需重启模块" : "端口未改变");
            if (data.warning) this.webuiSaveMessage += " · " + data.warning;
            if (data.changed) {
              if (["127.0.0.1","localhost","[::1]"].includes(window.location.hostname)) {
                this.webuiSaveMessage += " · " + this.t("通过 ADB 转发访问时，请在安装器重新打开管理页面");
              } else {
                const url = new URL(window.location.href);
                url.protocol = "http:"; url.port = String(data.http_port); url.pathname = this.noAuth ? "/" : "/login.html"; url.search = ""; url.hash = "";
                this.webuiNewUrl = url.href;
              }
            }
          } catch(error) { this.webuiSaveMessage = error.name === 'AbortError' ? this.t("请求超时，请重新检查当前端口") : error.message; }
          finally { clearTimeout(deadline); this.isSavingWebui = false; }
        },

        changeLoginPassword() {
          if (this.isSavingPassword) return;
          this.passwordSaveMessage = "";
          if (!this.currentPassword || !this.webUsername) {
            this.passwordSaveMessage = this.t("请输入当前密码和 Web 账号");
            return;
          }
          if (this.newPassword !== this.confirmPassword) {
            this.passwordSaveMessage = this.t("两次输入的新密码不一致");
            return;
          }

          this.isSavingPassword = true;
          return SimpleAdmin.Api.setPassword(this.currentPassword, this.newPassword, this.confirmPassword, this.webUsername)
            .then((res) => {
              return res.json().catch(() => ({})).then((data) => ({ res, data }));
            })
            .then(({ res, data }) => {
              if (!res.ok) {
                const error = data && data.error ? data.error : "";
                if (res.status === 403 || error === "current password incorrect") {
                  throw new Error("当前密码不正确");
                }
                if (error === "new password is empty") {
                  throw new Error("新密码不能为空");
                }
                if (error === "password confirmation mismatch") {
                  throw new Error("密码确认不一致");
                }
                throw new Error(error || "密码保存失败");
              }
              this.currentPassword = "";
              this.newPassword = "";
              this.confirmPassword = "";
              this.passwordSaveMessage = this.t("密码已保存，请使用新密码重新登录。");
              window.location.replace('/login.html');
            })
            .catch((error) => {
              console.error("保存登录密码失败：", error);
              this.passwordSaveMessage = this.t(error.message || "密码保存失败");
            })
            .finally(() => {
              this.isSavingPassword = false;
            });
        },

        closeModal() {
          this.showModal = false;
        },

        closeImeiModal() {
          this.showImeiModal = false;
        },

        showRebootModal() {
          this.showModal = true;
        },

        sendATCommand() {
          if (!this.atcmd) {
            this.atcmd = "ATI";
          }
          this.isLoading = true;
          // ★ 返回 fetch 的 Promise，这样外层可以 .then(...)
          return SimpleAdmin.Api.settingsData({ action: 'manual_at', command: this.atcmd })
            .then((data) => data.response || '')
            .then((data) => {
              this.atCommandResponse = data;
              this.isLoading = false;
              this.isClean = false;
              //this.fetchCurrentSettings();
              return data; // ★ 把结果再传下去，链式调用更方便
            })
            .catch((error) => {
              console.error("错误: ", error);
              this.showError = true;
              this.isLoading = false;
              throw error; // ★ 继续抛出，方便调用方捕获
            });
        },

        async setSleepMode(state) {
          if (state === '1' && !confirm('确定启用低功耗模式吗？启用后模组空闲休眠，串口 AT 响应可能略慢。')) return;
          this.sleepBusy = true;
          try {
            const data = await SimpleAdmin.Api.settingsData({ action: 'set_sleep_mode', enabled: state });
            if (data.ok === false) throw new Error(data.error || data.response || '操作失败');
            await this.fetchCurrentSettings();
            alert(state === '1' ? '低功耗模式已启用' : '低功耗模式已禁用');
          } catch (error) { alert('设置失败：' + (error.message || error)); }
          finally { this.sleepBusy = false; }
        },

        clearResponses() {
          this.atCommandResponse = "";
          this.isClean = true;
        },

        fillAtCommand(command) {
          this.atcmd = command;
          const input = document.getElementById('atCommandInput');
          if (input) input.focus();
        },

        loadAtFavorites() {
          try {
            const saved = JSON.parse(localStorage.getItem('simpleadmin.atFavorites') || '[]');
            this.atFavorites = Array.isArray(saved) ? saved.filter(f => f && f.command) : [];
          } catch (error) {
            console.warn('读取 AT 收藏失败：', error);
            this.atFavorites = [];
          }
        },

        saveAtFavorite() {
          const command = (this.atcmd || '').trim();
          if (!command) {
            alert('请先输入要保存的 AT 命令');
            return;
          }
          if (this.atFavorites.some(f => f.command === command)) {
            alert('该命令已存在');
            return;
          }
          const label = prompt('命令备注（按钮显示名）：', command);
          if (label === null) return;
          this.atFavorites.push({ label: (label || command).slice(0, 24), command });
          localStorage.setItem('simpleadmin.atFavorites', JSON.stringify(this.atFavorites));
        },

        removeAtFavorite(index) {
          this.atFavorites.splice(index, 1);
          localStorage.setItem('simpleadmin.atFavorites', JSON.stringify(this.atFavorites));
        },

        startRebootCountdown(seconds = 40) {
          if (this.rebootCountdownTimer) {
            clearInterval(this.rebootCountdownTimer);
          }
          this.atCommandResponse = "";
          this.showModal = false;
          this.showImeiModal = false;
          this.isRebooting = true;
          this.countdown = seconds;
          this.isRebooted = false;  // 重启标志位，表示设备尚未重启完成

          // 进行倒计时
          this.rebootCountdownTimer = setInterval(() => {
            this.countdown--;
            if (this.countdown <= 0) {
              clearInterval(this.rebootCountdownTimer);
              this.rebootCountdownTimer = null;
              this.isRebooting = false;

              // 给设备一些时间重启后再执行初始化
              setTimeout(() => {
                this.isRebooted = true;  // 设置标志为已重启
                this.init();  // 重启后执行初始化（发送必要的 AT 命令）
              }, 5000);  // 延迟 5 秒，以确保设备完全重启
            }
          }, 1000);
        },

        handleRebootNotice(data) {
          if (!data || !(data.reboot || data.rebooting)) {
            return false;
          }
          const seconds = Number(data.rebootCountdownSeconds) || 40;
          this.startRebootCountdown(seconds);
          return true;
        },

        rebootDevice() {
          SimpleAdmin.Api.settingsData({ action: 'reboot' });
          this.startRebootCountdown(40);
        },


        openImeiModal() {
          const val = (this.newImei || '').trim();
          if (!val) {
            alert('没有提供新的 IMEI。');
            return;
          }
          if (val.length !== 15 || !/^\d+$/.test(val)) {
            alert('IMEI 无效');
            return;
          }
          if (this.imei !== '-' && val === this.imei) {
            alert('IMEI 与当前 IMEI 相同');
            return;
          }
          this.showImeiModal = true;
        },

        updateIMEI() {
          const val = (this.newImei || '').trim();
          this.showImeiModal = false;
          this.isLoading = true;
          SimpleAdmin.Api.settingsData({ action: 'set_imei', imei: val })
            .catch((error) => {
              console.info('设置 IMEI 后设备重启或连接断开，继续保持重启倒计时：', error);
            })
            .finally(() => {
              this.isLoading = false;
            });
          this.startRebootCountdown(40);
        },

        // modemwebui 对齐：模组恢复出厂（AT+QCFG="ResetFactory"+重启，双确认）
        async resetFactory() {
          if (!confirm('确定要将模组恢复出厂设置吗？\n这将重置模组全部 AT 配置（PDP/频段/IMS 等）并重启模组。'))
            return;
          if (!confirm('再次确认：恢复出厂后蜂窝会断开约 1-2 分钟并自动重拨，继续吗？'))
            return;
          try {
            const data = await SimpleAdmin.Api.settingsData({ action: 'reset_factory' });
            if (data.ok === false) throw new Error(data.error || data.response || '操作失败');
            this.atCommandResponse = "";
            this.startRebootCountdown(75);
          } catch (error) {
            alert('恢复出厂失败：' + (error.message || error));
          }
        },

        resetATCommands() {
          SimpleAdmin.Api.settingsData({ action: 'reset_at' });
          this.atCommandResponse = "";
          this.showRebootModal();
        },

        ipPassThroughEnable() {
          if (this.ipPassMode != "未指定") {
            SimpleAdmin.Api.settingsData({ action: 'ip_passthrough', enabled: '1', mode: this.ipPassMode });
          } else {
            console.error("未指定 IP 透传模式");
          }
        },

        ipPassThroughDisable() {
          this.showError = false;
          this.atCommandResponse = this.t("正在禁用 IP 透传，网口会重启，请等待倒计时结束。");
          this.startRebootCountdown(40);

          SimpleAdmin.Api.settingsData({ action: 'ip_passthrough', enabled: '0' })
            .then((data) => {
              if (data && data.response) {
                this.atCommandResponse = data.response;
              }
              if (!this.handleRebootNotice(data) && data && data.ok === false) {
                this.showError = true;
              }
            })
            .catch((error) => {
              console.info("禁用 IP 透传期间网口/WebSocket 断开，继续保持重启倒计时：", error);
              if (!this.isRebooting) {
                this.startRebootCountdown(40);
              }
            });
        },

        onBoardDNSV6ProxyEnable() {
          SimpleAdmin.Api.settingsData({ action: 'dns_proxy', family: '6', enabled: '1' }).then(() => {
            this.fetchCurrentSettings();
          });
        },
        onBoardDNSV4ProxyEnable() {
          SimpleAdmin.Api.settingsData({ action: 'dns_proxy', family: '4', enabled: '1' }).then(() => {
            this.fetchCurrentSettings();
          });
        },

        onBoardDNSV6ProxyDisable() {
          SimpleAdmin.Api.settingsData({ action: 'dns_proxy', family: '6', enabled: '0' }).then(() => {
            this.fetchCurrentSettings();
          });
        },
        onBoardDNSV4ProxyDisable() {
          SimpleAdmin.Api.settingsData({ action: 'dns_proxy', family: '4', enabled: '0' }).then(() => {
            this.fetchCurrentSettings();
          });
        },


        async usbNetModeChanger() {
          if (this.usbNetMode === "未指定") {
            console.error("未指定 USB 网络模式");
            return;
          }

          const map = { RMNET: 0, ECM: 1, MBIM: 2, RNDIS: 3 };
          const code = map[this.usbNetMode];
          if (code === undefined) {
            console.warn("USB 网络模式无效");
            return;
          }

          try {
            const result = await SimpleAdmin.Api.settingsData({ action: 'usbnet', mode: this.usbNetMode });  // 等待设置成功
            if (result && result.error) {
              alert('USB 协议设置未执行：' + result.error);
              this.fetchCurrentSettings();
              return;
            }
            // 成功后只弹出确认重启的模态框
            this.showRebootModal();
          } catch (e) {
            console.error("设置 usbnet 失败：", e);
            alert('USB 协议设置失败：' + (e && e.message ? e.message : e));
          }
        },

        fetchCurrentSettings() {
          if (!this.isRebooted) {
            return;  // 如果设备还在重启，跳过
          }
          SimpleAdmin.Api.settingsData({ action: 'status' })
            .then((data) => {
              this.sleepModeEnabled = data.sleepModeEnabled ?? "-";
              // 当前飞行模式态与短信中心（与设备信息页同源同步）
              SimpleAdmin.Api.getATText('AT+CFUN?').then(txt => {
                const m = String(txt).match(/\+CFUN:\s*(\d+)/);
                this.airplaneState = m ? (m[1] === '0' ? '飞行中' : '正常') : '';
              }).catch(() => {});
              SimpleAdmin.Api.getATText('AT+CSCA?').then(txt => {
                const m = String(txt).match(/\+CSCA:\s*"([^"]*)"/);
                if (m) this.currentSmsc = m[1];
              }).catch(() => {});
              this.ipPassStatus = !!data.ipPassStatus;
              this.DNSV6ProxyStatus = !!data.DNSV6ProxyStatus;
              this.DNSV4ProxyStatus = !!data.DNSV4ProxyStatus;
              this.currentUsbNetMode = data.currentUsbNetMode || '未知';
              const currentDmzIp = String(data.dmzIP || '').trim();
              this.dmzIP = currentDmzIp;
              this.dmzMode = this.resolveDmzMode(data.dmzMode, currentDmzIp);
              this.lanIpStart = data.lanIpStart || '';
              this.lanIpEnd = data.lanIpEnd || '';
              this.lanGwIp = data.lanGwIp || '';
              const oldImei = this.imei;
              const currentImei = (data.imei || '').trim();
              if (/^\d{14,17}$/.test(currentImei)) {
                this.imei = currentImei;
                if (!this.newImei || this.newImei === '-' || this.newImei === oldImei) {
                  this.newImei = currentImei;
                }
              }
            })
            .catch((error) => {
              console.error("错误: ", error);
              this.showError = true;
            });
        },

        _explainAtFailure(data) {
          const raw = (data && (data.error || data.response)) || '';
          if (!raw) return '';
          const cme = raw.match(/CME ERROR:\s*(\d+)/);
          if (cme) {
            const table = { 3: '操作不被允许（当前状态不支持）', 4: '不支持该操作', 10: '未插 SIM 卡', 11: '需要 PIN 码', 12: '需要 PUK 码', 13: 'SIM 卡失败', 14: 'SIM 卡忙', 16: 'PIN 码错误', 17: '需要 PUK 码' };
            const why = table[Number(cme[1])];
            return why ? why + '（CME ' + cme[1] + '）' : raw;
          }
          if (raw.includes('blocked')) return raw.replace(/^.*blocked[：:]?/, '').split('。')[0];
          return raw.replace(/\r?\n/g, ' ').slice(0, 120);
        },
        async _settingsAction(params) {
          try {
            // settingsData (postJSON) 已返回解析后的对象,不能再调 res.json()
            const data = await SimpleAdmin.Api.settingsData(params);
            if (!data || data.ok === false || data.error) {
              alert('操作失败：' + (this._explainAtFailure(data) || (data && data.error) || '未知错误'));
              return false;
            }
            return true;
          } catch (e) {
            alert('操作失败：' + (e && e.message ? e.message : e));
            return false;
          }
        },
        async airplaneToggle() {
          let isOn = false;
          try {
            const txt = await SimpleAdmin.Api.getATText('AT+CFUN?');
            isOn = /CFUN:\s*0/.test(txt || '');
          } catch (e) { /* 查询失败按当前非飞行处理 */ }
          const msg = isOn ? '关闭飞行模式（恢复射频）？' : '开启飞行模式？将断开蜂窝网络，之后可再次点击恢复。';
          if (!window.confirm(msg)) return;
          if (await this._settingsAction({ action: isOn ? 'airplane_off' : 'airplane_on' })) {
            // 即时本地更新按钮态（CFUN 真值已切换，等轮询回读会滞后一轮）
            this.airplaneState = isOn ? '正常' : '飞行中';
            this.fetchCurrentSettings();
            alert(isOn ? '已恢复射频，网络将自动重连' : '已进入飞行模式');
          }
        },
        async pinEnter() {
          if (await this._settingsAction({ action: 'pin_enter', pin: this.pinUnlockInput })) {
            alert('PIN 已提交；若仍提示需要 PIN/PUK 请稍后重试');
            this.pinUnlockInput = '';
          }
        },
        async pinChange() {
          if (!window.confirm('确认修改 SIM PIN 码？新 PIN 立即生效。')) return;
          if (await this._settingsAction({ action: 'pin_change', old_pin: this.pinOldInput, new_pin: this.pinNewInput })) {
            alert('PIN 码已修改');
            this.pinOldInput = ''; this.pinNewInput = '';
          }
        },
        async simlockSet(state) {
          const label = state === '1' ? '开启 SIM 卡锁（每次上电需输 PIN，忘锁有烧卡风险！）' : '关闭 SIM 卡锁';
          if (!window.confirm('确认' + label + '？')) return;
          if (await this._settingsAction({ action: 'simlock', enabled: state, pin: this.simlockPinInput })) {
            alert('SIM 卡锁已' + (state === '1' ? '开启' : '关闭'));
            this.simlockPinInput = '';
          }
        },
        async smscSet() {
          if (!window.confirm('确认修改短信中心为 ' + this.smscInput + '？设置错误将导致无法收发短信。')) return;
          if (await this._settingsAction({ action: 'smsc_set', smsc: this.smscInput })) {
            this.currentSmsc = this.smscInput;
            alert('短信中心已保存');
          }
        },
        fetchTTL() {
          SimpleAdmin.Api.getTTLStatus()
            .then((res) => {
              return res.json();
            })
            .then((data) => {
              this.ttldata = data;
              this.ttlStatus = this.ttldata.isEnabled;
              this.ttlvalue = this.ttldata.ttl;
            })
            .catch((error) => {
              console.error("Error fetching TTL status: ", error); // 日志：捕获错误
            });
        },

        setTTL() {
          const ttlValueWithoutLeadingZero = parseInt(this.newTTL, 10);

          // 如果 ttlValueWithoutLeadingZero 是 null, 空字符串 "", 负值，或者大于 255，则退出
          if (isNaN(ttlValueWithoutLeadingZero) || ttlValueWithoutLeadingZero < 0 || ttlValueWithoutLeadingZero > 255) {
            this.ttlMessage = 'TTL 需为 0-255 的整数';
            return;
          }
          this.ttlMessage = '';

          this.isLoading = true; // 设置 TTL 更新期间的加载状态
          const ttlval = ttlValueWithoutLeadingZero;

          SimpleAdmin.Api.setTTL(ttlval)
            .then((res) => {
              return res.text(); // 使用 res.text() 获取响应数据
            })
            .then((data) => {
              this.fetchTTL();  // 更新 TTL 状态
              this.isLoading = false; // 将加载状态设置回 false
            })
            .catch((error) => {
              console.error("Error setting TTL: ", error); // 日志：捕获错误
              this.isLoading = false; // 确保在出现错误时正确处理加载状态
            });
        },

        validIPv4(value) {
          const m = String(value || '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
          return !!m && m.slice(1).every(part => Number(part) <= 255);
        },
        digitsOnly(field) {
          this[field] = String(this[field] || '').replace(/\D/g, '').slice(0, 8);
        },
        setDMZEnable() {
          // 启用 DMZ，校验 IPv4 格式（原仅判非空，非法串会直发模组）
          if (!this.validIPv4(this.dmzIP)) {
            alert('请输入合法的 IPv4 地址（例如 192.168.100.10）');
            return;
          }
          if (this.dmzIP) {
            SimpleAdmin.Api.settingsData({ action: 'dmz', enabled: '1', ip: this.dmzIP });
            this.atCommandResponse = "";
            this.showModal = false;
            this.dmzMode = '1';  // 更新为启用状态
          } else {
            console.error("请输入有效的 IP 地址！");
          }
        },

        setDMZDisable() {
          // 禁用 DMZ
          SimpleAdmin.Api.settingsData({ action: 'dmz', enabled: '0' });
          this.dmzMode = '0';  // 更新为禁用状态
          this.atCommandResponse = "";
          this.showModal = false;
        },
        setLANIP() {
          this.lanIpSaveSuccess = false;
          if (this.lanIpSaveSuccessTimer) {
            clearTimeout(this.lanIpSaveSuccessTimer);
            this.lanIpSaveSuccessTimer = null;
          }

          // 检查网关 IP 地址和起始/结束 IP 地址的最后一位是否已填写
          if (!this.lanGwIp || !this.lanIpStart || !this.lanIpEnd) {
            console.error("请输入有效的网关 IP 地址和起始、结束 IP 地址！");
            return;
          }

          // 提取网关 IP 地址的前三位
          const gwIpParts = this.lanGwIp.split('.');

          // 网关须为合法 IPv4；起始/结束须为 1-253 整数（最后一位与网关拼接）
          if (!this.validIPv4(this.lanGwIp)) {
            alert("网关 IP 地址格式无效（示例 192.168.100.1）");
            return;
          }
          const lanStart = parseInt(this.lanIpStart, 10);
          const lanEnd = parseInt(this.lanIpEnd, 10);
          if (!Number.isInteger(lanStart) || !Number.isInteger(lanEnd) || lanStart < 1 || lanEnd < 1 || lanStart > 253 || lanEnd > 253) {
            alert("起始/结束地址需为 1-253 的整数（地址最后一位）");
            return;
          }
          if (lanStart > lanEnd) {
            alert("起始地址不能大于结束地址");
            return;
          }

          // 使用网关 IP 地址的前三位与用户输入的最后一位拼接成完整的起始和结束 IP
          const startIp = `${gwIpParts[0]}.${gwIpParts[1]}.${gwIpParts[2]}.${this.lanIpStart}`;
          const endIp = `${gwIpParts[0]}.${gwIpParts[1]}.${gwIpParts[2]}.${this.lanIpEnd}`;

          this.isSavingLANIP = true;
          this.atCommandResponse = "";
          this.showModal = false;

          return SimpleAdmin.Api.settingsData({ action: 'lanip', start: startIp, end: endIp, gateway: this.lanGwIp })
            .then((data) => {
              if (data && data.ok === false) {
                throw new Error(data.error || "LAN IP 设置失败");
              }
              this.lanIpSaveSuccess = true;
              this.lanIpSaveSuccessTimer = setTimeout(() => {
                this.lanIpSaveSuccess = false;
                this.lanIpSaveSuccessTimer = null;
              }, 3000);
            })
            .catch((error) => {
              console.error("LAN IP 设置失败：", error);
            })
            .finally(() => {
              this.isSavingLANIP = false;
            });
        },

        init() {
          if (!this.isRebooted) {
            return;  // 如果设备正在重启，跳过
          }

          this.fetchWebuiSetting();
          this.fetchLanguageSetting();  // 获取界面语言设置
          this.fetchCurrentSettings();  // 发送 AT 命令获取当前设置
          this.fetchTTL();  // 获取 TTL 状态
          this.loadAtFavorites();  // AT 终端自定义收藏（localStorage）
        },
      };
    }

    if (window.SimpleAdminSpaMode) {
      (window.SimpleAdmin.Pages = window.SimpleAdmin.Pages || {}).settings = simpleSettings;
    } else {
      mountSimpleAdminVueApp(simpleSettings);
    }
