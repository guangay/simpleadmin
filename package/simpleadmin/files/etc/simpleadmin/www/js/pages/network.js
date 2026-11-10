function cellLocking() {
      return {
        // ---------- 状态 ----------
        isLoading: false,
        neighbourCells: [],
        neighbourLoading: false,
        neighbourSummary: "",
        showModal: false,
        countdown: 0,
        networkModeCell: "-",
        // 兼容现有绑定（10 组 EARFCN/PCI）
        earfcn1: null, pci1: null,
        earfcn2: null, pci2: null,
        earfcn3: null, pci3: null,
        earfcn4: null, pci4: null,
        earfcn5: null, pci5: null,
        earfcn6: null, pci6: null,
        earfcn7: null, pci7: null,
        earfcn8: null, pci8: null,
        earfcn9: null, pci9: null,
        earfcn10: null, pci10: null,
        scs: null,
        band: null,
        apn: "-",
        newApn: null,
        prefNetwork: "-",
        prefNetworkMode: null,
        nrModeControl: "-",
        cellNum: null,
        gw_bands: null,
        lte_bands: null,
        nsa_bands: null,
        sa_bands: null,
        locked_gw_bands: null,
        locked_lte_bands: null,
        locked_nsa_bands: null,
        locked_sa_bands: null,
        currentNetworkMode: "-",
        updatedLockedBands: null,
        updatedLockedBandsByMode: { GW: [], LTE: [], NSA: [], SA: [] },
        cellLockStatus: "未知",
        lockPersistence: 'temporary', lockAutoUnlock: true, lockBusy: false, lockMessage: '', lockRadios: [],
        lockTimer: null, lockEventsBound: false, lockRefreshBusy: false,
        lockLanguage: SimpleAdmin.Lang.getCurrentLanguage(),
        lockStatusText(state) {
          const key=({temporary:'临时锁频',persistent:'持久化锁频',connected:'已拨号，锁频保持',locked:'已锁定',unlocked:'未锁定',fallback:'已超时回退，开机恢复已关闭',fallback_error:'回退失败，正在重试'})[state.phase] || (state.persistent?'等待开机恢复':'未锁定');
          return this.lockLanguage==='zh-CN'?key:SimpleAdmin.Lang.t(key);
        },
        // 锁定详情：NR=[pci,earfcn,scs,band]；LTE=[count,earfcn1,pci1,...]
        lockDetailText(state) {
          const v = state.values;
          if (!Array.isArray(v) || !v.length) return '';
          if (state.radio === 'nr' && v.length >= 4) {
            return 'PCI ' + v[0] + ' · EARFCN ' + v[1] + ' · SCS ' + v[2] + ' kHz · Band ' + v[3];
          }
          if (state.radio === 'lte' && v.length >= 3) {
            const cells = [];
            for (let i = 1; i + 1 < v.length; i += 2) cells.push('EARFCN ' + v[i] + ' / PCI ' + v[i + 1]);
            return (cells.length > 1 ? cells.length + ' 个小区：' : '') + cells.join('；');
          }
          return v.join(', ');
        },
        async refreshCellLocks() {
          if(this.lockRefreshBusy) return;
          this.lockRefreshBusy=true;
          try {const data=await SimpleAdmin.Api.networkData({action:'cell_lock_status'});this.lockRadios=data.radios||[];} finally {this.lockRefreshBusy=false;}
        },
        async requestCellLock(params) {
          this.lockBusy=true;this.lockMessage='';
          try {
            const data=await SimpleAdmin.Api.networkData({persistence:this.lockPersistence,auto_unlock:this.lockAutoUnlock?'1':'0',...params});
            if(data.ok===false) throw new Error(data.error||data.response||'锁频失败');
            this.lockRadios=data.cell_lock.radios;this.lockMessage=data.warning||SimpleAdmin.Lang.t('已保存');
            return data;
          } catch(error) {this.lockMessage=error.message;throw error;} finally {this.lockBusy=false;}
        },
        async restoreSavedLock(state) {
          const v=state.values;if(!v)return;
          const params=state.radio==='lte'?{action:'lock_lte_manual',cellNum:v[0],pairs:Array.from({length:v[0]},(_,i)=>v.slice(1+i*2,3+i*2).join(',')).join(';')}:{action:'lock_nr_manual',pci:v[0],earfcn:v[1],scs:v[2],band:v[3]};
          try {await this.requestCellLock({...params,persistence:'persistent',auto_unlock:state.auto_unlock?'1':'0'});}catch(_){}
        },
        async cancelSavedLock(state) {try {await this.requestCellLock({action:state.radio==='lte'?'unlock_lte':'unlock_nr'});}catch(_){}},
        bands: "获取频段中...",
        isGettingBands: false,
        // 频段矩阵移动端默认收起（85+ 复选框占半屏），桌面默认展开
        bandPanelOpen: (typeof window !== 'undefined' ? window.innerWidth >= 576 : true),
        pdpType: "-",
        newPdpType: null,
        nrModeControlCurrent: null,
        nrModeControlNew: null,
        // PDP 上下文管理（QModem 对齐：列表/激活状态/增删改/激活去激活）
        pdpContexts: [],
        pdpBusy: false,
        showPdpModal: false,
        pdpModalMode: 'new',
        pdpForm: { cid: null, pdpType: 'IPV4V6', apn: '' },
        // 网络功能开关（QModem/modemwebui 对齐：IMS、SIM 热插拔、漫游、卡槽）
        imsEnabled: '-',
        simHotswapEnabled: '-',
        roamPref: '-',
        simSlot: '-',
        simSlots: [],
        featureBusy: false,
        featureMessage: '',
        profileMessage: '',
        pdpMessage: '',
        lteLockInfo: '',
        nrLockInfo: '',
        _bandsFetchInFlight: {},
        _bandsRetryTimers: {},
        _bandsRetryCount: {},
        _initialized: false,
        _currentSettingsFetchInFlight: null,
        model: "-",
        _modelFetchInFlight: null,
        selectedCells: [],
        scannedCells: [],
        nr5g_cells: [],
        lte_cells: [],
        nr5g_cells_parsed: [],
        lte_cells_parsed: [],
        atcmd: "",
        tableRows: [],
        nr5g_neighbourCells: [],
        lte_neighbourCells: [],
        nr5g_neighbourCellsParsed: [],
        lte_neighbourCellsParsed: [],
        neighbourCellsTableRows: [],
        cellScanMode: "Unspecified",
        neighbourCellsScanMode: "Unspecified",
        isLoading: false,
        isCellScanning: false,
        isneighbourScanning: false,
        resultDoneCell: false,
        resultDoneNeighbourCell: false,

        async startCellScan() {
          // 锁定生效期间 QSCAN 只能测锁定频点、常返回空（真机实测）——提前告知
          try {
            const cl = await SimpleAdmin.Api.networkData({ action: 'cell_lock_status' });
            const locked = (cl.radios || []).filter(r => r.phase && r.phase !== 'unlocked');
            if (locked.length) {
              const desc = locked.map(r => (r.radio === 'nr' ? 'NR5G-SA' : 'LTE') + (r.values ? '（' + this.lockDetailText(r) + '）' : '')).join('、');
              if (!confirm('检测到小区锁定生效中：' + desc + '。\n锁定期间扫描结果会受限或为空，建议先解锁再扫描。仍要继续吗？'))
                return;
            }
          } catch (e) { /* 状态查询失败不阻塞扫描 */ }
          this.clearCellScanData();

          this.isLoading = true;
          this.isCellScanning = true;

          SimpleAdmin.Api.networkData({ action: 'scan', mode: this.cellScanMode })
            .then(data => {
              this.nr5g_cells_parsed = data.nr5g_cells_parsed || [];
              this.lte_cells_parsed = data.lte_cells_parsed || [];
              this.generateTableRow();
            })
            .then(() => {
              this.isLoading = false;
              this.isCellScanning = false;
              this.resultDoneCell = true;
            })
            .catch(error => {
              console.error("Error processing scan data:", error);
              this.isLoading = false;
              this.isCellScanning = false;
            });

        },
        generateTableRow() {
          const tableBody = document.getElementById("cellScanTableBody");
          //tableBody.innerHTML = "";
          const tableEl = tableBody.closest("table");
          if (!tableEl.querySelector("thead")) {
            // 表头只插一次（此前按 tbody 行数判断，二次扫描会重复插入）
            const tableHeader = `
              <thead>
                <tr>
                  <th scope="col">选择</th>
                  <th scope="col">网络</th>
                  <th scope="col">运营商</th>
                  <th scope="col">频段</th>
                  <th scope="col">频点</th>
                  <th scope="col">PCI</th>
                  <th scope="col">RSRP</th>
                  <th scope="col">信号</th>
                </tr>
              </thead>
            `;
            tableBody.insertAdjacentHTML("beforebegin", tableHeader);
          }
          this.tableRows = [];

          const cells = this.cellScanMode === "Full Scan"
            ? [...this.nr5g_cells_parsed, ...this.lte_cells_parsed]
            : this.cellScanMode === "NR5G Only"
              ? this.nr5g_cells_parsed
              : this.lte_cells_parsed;

          this.scannedCells = cells;

          cells.forEach((cell, idx) => {
            const signalSvg = this.signalIconSVG(cell.rsrp);
            const isChecked = this.selectedCells.some(selectedCell => selectedCell.idx === idx);

            this.tableRows.push(`
              <tr class="table-row" data-idx="${idx}">
                <th scope="row">
                  <label class="sa-cellcheck"><input type="checkbox" class="checkbox-cell" data-idx="${idx}"
                        ${isChecked ? 'checked' : ''} /><span></span></label>
                </th>
                <td>${cell.type}</td>
                <td>${cell.provider}</td>
                <td>${cell.band}</td>
                <td>${cell.freq}</td>
                <td>${cell.pci}</td>
                <td>${cell.rsrp}</td>
                <td>${signalSvg}</td>
              </tr>
            `);
          });

          tableBody.innerHTML = this.tableRows.join('');

          const rows = tableBody.querySelectorAll('.table-row');
          rows.forEach(row => {
            row.addEventListener('click', (e) => {
              const checkbox = row.querySelector('.checkbox-cell');

              if (e.target !== checkbox) {
                checkbox.checked = !checkbox.checked;
              }

              this.toggleCellSelection(Number(checkbox.dataset.idx));
            });
          });
        },
        toggleCellSelection(idx) {
          const cell = this.scannedCells[idx];
          if (!cell) return;
          // NR5G 单选（点新小区替换、点已选取消）；LTE/全面扫描多选；
          // 修正：旧版首点即弹"只能锁一个"并 return，NR 模式永远选不上
          const single = this.cellScanMode === "NR5G Only" || cell.type === "NR5G";
          const index = this.selectedCells.findIndex(c => c.idx === idx);
          if (single) {
            this.selectedCells = (index === -1) ? [Object.assign({ idx }, cell)] : [];
          } else if (index === -1) {
            this.selectedCells.push(Object.assign({ idx }, cell));
          } else {
            this.selectedCells.splice(index, 1);
          }
          this.updateTableRowSelection();
        },
        updateTableRowSelection() {
          document.querySelectorAll("input.checkbox-cell").forEach(checkbox => {
            const idx = Number(checkbox.getAttribute("data-idx"));
            checkbox.checked = this.selectedCells.some(cell => cell.idx === idx);
          });
        },
        signalIconSVG(rsrp) {
          const levels = [
            { min: -55, svg: `<line x1="2" y1="20" x2="2" y2="20" /><line x1="7" y1="20" x2="7" y2="16" /><line x1="12" y1="20" x2="12" y2="12" /><line x1="17" y1="20" x2="17" y2="8" /><line x1="22" y1="20" x2="22" y2="4" />` },
            { min: -85, svg: `<line x1="2" y1="20" x2="2" y2="20" /><line x1="7" y1="20" x2="7" y2="16" /><line x1="12" y1="20" x2="12" y2="12" /><line x1="17" y1="20" x2="17" y2="8" />` },
            { min: -95, svg: `<line x1="2" y1="20" x2="2" y2="20" /><line x1="7" y1="20" x2="7" y2="16" /><line x1="12" y1="20" x2="12" y2="12" />` },
            { min: -Infinity, svg: `<line x1="2" y1="20" x2="2" y2="20" /><line x1="7" y1="20" x2="7" y2="16" />` }
          ];
          const level = levels.find(l => rsrp >= l.min);
          return level ? `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${level.svg}</svg>` : '';
        },
        clearCellScanData() {
          this.nr5g_cells = [];
          this.lte_cells = [];
          this.nr5g_cells_parsed = [];
          this.lte_cells_parsed = [];
          this.tableRows = [];
        },
        clearTableRowsBodyCellScan() {
          this.clearCellScanData();
          this.resultDoneCell = false;
          const tableBody = document.getElementById("cellScanTableBody");
          const tableEl = tableBody.closest("table");
          const oldHead = tableEl && tableEl.querySelector("thead");
          if (oldHead) oldHead.parentNode.removeChild(oldHead);
          this.selectedCells = [];
          tableBody.innerHTML = `
            <tr>
              <th scope="row">空</th>
              <td>空</td>
              <td>空</td>
              <td>空</td>
              <td>空</td>
              <td>空</td>
              <td>空</td>
              <td>空</td>
            </tr>
          `;
        },
        async lockSelectedCells() {
          if (this.selectedCells.length === 0) {
            alert("请先点击扫描结果行勾选要锁定的小区");
            return;
          }
          const cells = this.selectedCells;
          const nrCells = cells.filter(c => c.type === "NR5G");
          const lteCells = cells.filter(c => c.type !== "NR5G");
          const lockFailures = [];

          if (nrCells.length && lteCells.length) {
            // 全面扫描混选：模组一次只能锁一种制式，提示分开操作
            alert("LTE 与 NR5G 小区不能同时锁定。\n请仅勾选其中一种制式后重试（全面扫描结果同样适用）。");
            return;
          }
          if (nrCells.length > 1) {
            alert("NR5G-SA 每次只能锁定 1 个小区");
            return;
          }
          if (nrCells.length === 1) {
            const c = nrCells[0];
            await this.requestCellLock({
              action: 'lock_scanned_cells', mode: 'NR5G Only',
              pci: c.pci, earfcn: c.freq, scs: 30, band: c.band
            }).catch(error => { lockFailures.push(error && error.message ? error.message : String(error)); });
          } else if (lteCells.length) {
            if (lteCells.length > 10) {
              alert("最多只能选择 10 条 LTE 小区进行锁定");
              return;
            }
            await this.requestCellLock({
              action: 'lock_scanned_cells', mode: 'LTE Only',
              earfcn: lteCells.map(c => c.freq).join(','),
              pci: lteCells.map(c => c.pci).join(',')
            }).catch(error => { lockFailures.push(error && error.message ? error.message : String(error)); });
          }

          await this.startModalCountdown(3);
          if (lockFailures.length) {
            alert('有 ' + lockFailures.length + ' 条锁定命令发送失败：\n' + lockFailures.join('\n'));
          } else {
            alert('锁定命令已提交，正在等待模组生效');
          }
          await this.init();
        },

        // ---------- 工具函数 ----------
        sleep(ms) { return new Promise(r => setTimeout(r, ms)); },
        async startModalCountdown(seconds = 1) {
          this.showModal = true;
          this.countdown = seconds;
          while (this.countdown > 0) {
            await this.sleep(1000);
            this.countdown--;
          }
          this.showModal = false;
        },

        // ---------- 业务逻辑 ----------

        // ---------- 频段候选（真实模组数据，无静态型号表） ----------
        // 固件无能力枚举命令（QNWPREFCFG="x_band",? / =? 均 ERROR），且锁定后
        // 查询只回锁定集。候选 = 历史能力基准 ∪ 当前查询值：未锁定时查询值即
        // 模组支持全集，基准随查询/恢复出厂单调扩充；换模组（型号变）自动失效。
        bandCapacity: { GW: '', LTE: '', NSA: '', SA: '' },

        loadBandCapacity() {
          const model = (this.model && this.model !== '-') ? this.model : 'unknown';
          let stored = null;
          try { stored = JSON.parse(localStorage.getItem('sa_band_capacity') || 'null'); } catch (e) { stored = null; }
          const cap = (stored && stored.model === model && stored.bands) ? stored.bands : {};
          this.bandCapacity = { GW: cap.GW || '', LTE: cap.LTE || '', NSA: cap.NSA || '', SA: cap.SA || '' };
          this.syncCandidateBands();
        },

        persistBandCapacity() {
          try {
            const model = (this.model && this.model !== '-') ? this.model : 'unknown';
            localStorage.setItem('sa_band_capacity', JSON.stringify({ model: model, bands: this.bandCapacity }));
          } catch (e) { /* 无 localStorage（隐私模式）时退化为会话内基准 */ }
        },

        mergeBandCapacity(mode, liveValue) {
          const merged = unionBands(this.bandCapacity[mode], liveValue);
          if (merged !== this.bandCapacity[mode]) {
            this.bandCapacity[mode] = merged;
            this.persistBandCapacity();
          }
        },

        syncCandidateBands() {
          this.gw_bands = this.bandCapacity.GW;
          this.lte_bands = this.bandCapacity.LTE;
          this.nsa_bands = this.bandCapacity.NSA;
          this.sa_bands = this.bandCapacity.SA;
        },

        renderBandCheckboxes() {
          this.syncCandidateBands();
          populateCheckboxes(
            this.gw_bands,
            this.lte_bands,
            this.nsa_bands,
            this.sa_bands,
            this.locked_gw_bands || '',
            this.locked_lte_bands || '',
            this.locked_nsa_bands || '',
            this.locked_sa_bands || '',
            this,
            this.isGettingBands ? '正在从模组获取频段...' : '暂无频段数据（模组未返回或该制式不支持）'
          );
          this.trackCheckboxChanges();
          updateButtonText();
        },

        bandModes() {
          return ['GW', 'LTE', 'NSA', 'SA'];
        },

        lockedBandsLoaded(mode) {
          if (mode === 'GW') return this.locked_gw_bands !== null;
          if (mode === 'LTE') return this.locked_lte_bands !== null;
          if (mode === 'NSA') return this.locked_nsa_bands !== null;
          if (mode === 'SA') return this.locked_sa_bands !== null;
          return this.bandModes().every(m => this.lockedBandsLoaded(m));
        },

        setLockedBandsForMode(mode, data) {
          this.setAllLockedBands({ ...this._lockedSnapshot(), ...this._pickLocked(data, [mode]) });
        },

        _lockedSnapshot() {
          return {
            locked_gw_bands: this.locked_gw_bands || '',
            locked_lte_bands: this.locked_lte_bands || '',
            locked_nsa_bands: this.locked_nsa_bands || '',
            locked_sa_bands: this.locked_sa_bands || '',
          };
        },

        _pickLocked(data, modes) {
          const out = {};
          modes.forEach(m => {
            const v = data['locked_' + m.toLowerCase() + '_bands'];
            if (v !== undefined) out['locked_' + m.toLowerCase() + '_bands'] = v;
          });
          return out;
        },

        setAllLockedBands(data) {
          this.locked_gw_bands = data.locked_gw_bands || '';
          this.locked_lte_bands = data.locked_lte_bands || '';
          this.locked_nsa_bands = data.locked_nsa_bands || '';
          this.locked_sa_bands = data.locked_sa_bands || '';
          this.bandModes().forEach(m => {
            const live = data['locked_' + m.toLowerCase() + '_bands'] || '';
            if (live) this.mergeBandCapacity(m, live);
          });
        },

        scheduleBandsRetry(mode) {
          const retryMode = mode || 'ALL';
          const count = this._bandsRetryCount[retryMode] || 0;
          if (count >= 3) {
            return;
          }
          this._bandsRetryCount[retryMode] = count + 1;
          if (this._bandsRetryTimers[retryMode]) {
            clearTimeout(this._bandsRetryTimers[retryMode]);
          }
          this._bandsRetryTimers[retryMode] = setTimeout(() => {
            delete this._bandsRetryTimers[retryMode];
            if (!this.lockedBandsLoaded(retryMode)) {
              this.getSupportedBands(true, retryMode);
            }
          }, 1200);
        },

        async getSupportedBands(force = false, mode = 'ALL') {
          const selectedMode = String(mode || 'ALL').toUpperCase();

          // 已经拿过锁定频段时只重绘，不重复请求 AT。
          if (!force && this.lockedBandsLoaded(selectedMode)) {
            this.renderBandCheckboxes();
            return;
          }

          // 同一模式已有请求时，直接复用；单模式和全部模式互不影响。
          if (this._bandsFetchInFlight[selectedMode]) return this._bandsFetchInFlight[selectedMode];

          this.isGettingBands = true;

          const waitForResult = force ? '1' : '0';
          const payload = { action: 'bands', wait: waitForResult, force: force ? '1' : '0' };
          if (selectedMode !== 'ALL') payload.mode = selectedMode;

          this._bandsFetchInFlight[selectedMode] = SimpleAdmin.Api.networkData(payload)
            .then(data => {
              if (data.pending || data.error) {
                this.renderBandCheckboxes();
                this.scheduleBandsRetry(selectedMode);
                return;
              }
              if (selectedMode === 'ALL') {
                this.setAllLockedBands(data);
              } else {
                this.setLockedBandsForMode(selectedMode, data);
              }
              this._bandsRetryCount[selectedMode] = 0;
              this.renderBandCheckboxes();
            })
            .finally(() => {
              delete this._bandsFetchInFlight[selectedMode]; // 清空当前模式请求标记
              this.isGettingBands = Object.keys(this._bandsFetchInFlight).length > 0;
            });

          return this._bandsFetchInFlight[selectedMode];
        },
        async fetchNeighbour(force) {
          if (this.neighbourLoading) return;
          this.neighbourLoading = true;
          try {
            const data = await SimpleAdmin.Api.networkData({ action: 'neighbour' });
            this.neighbourCells = Array.isArray(data.cells) ? data.cells : [];
            this.neighbourSummary = this.neighbourCells.length ? `共 ${this.neighbourCells.length} 个邻区` : '';
          } catch (err) {
            console.warn('邻区查询失败：', err);
            this.neighbourSummary = '查询失败';
          } finally {
            this.neighbourLoading = false;
          }
        },

        async init() {
          if(!this.lockEventsBound){
            this.lockEventsBound=true;
            window.addEventListener('simpleadmin:language-changed',()=>{this.lockLanguage=SimpleAdmin.Lang.getCurrentLanguage();});
            const sync=()=>{const active=document.querySelector('[data-page="network"]').classList.contains('active');if(active){this.refreshCellLocks().catch(()=>{});this.fetchNeighbour(false).catch(()=>{});if(!this.lockTimer){this._lockFail=0;this.lockTimer=setInterval(()=>{if(this._lockFail>=2&&this._lockFail%6!==0){this._lockFail++;return;}this._lockFail++;this.refreshCellLocks().then(()=>{this._lockFail=0;}).catch(()=>{});},5000);}}else{clearInterval(this.lockTimer);this.lockTimer=null;}};
            window.addEventListener('simpleadmin:page-changed',sync);sync();
          }
          // 初始化时，禁止用户操作（还没有准备好）
          this._initialized = false;

          await this.getModel();          // 先确定型号（localStorage 基准按型号隔离）
          this.loadBandCapacity();       // 恢复历史能力基准（真实模组数据沉淀）
          this.renderBandCheckboxes();   // 先显示 3G(WCDMA) / LTE / NR5G-NSA / NR5G-SA 四列
          const lockedBandsPromise = this.getSupportedBands(true, 'ALL'); // 随即强制发送 AT 查询当前已锁定频段
          await Promise.all([
            this.getCurrentSettings(),          // 获取当前网络状态，避免被首次频段查询影响
            lockedBandsPromise
          ]);
          //this.clearTableRowsBodyCellScan();

          // 初始化完成后，允许处理用户操作
          this._initialized = true;
        },

        getBandCheckboxes(mode) {
          return document.querySelectorAll(`input.checkbox-band[data-band-mode="${mode}"]`);
        },

        trackCheckboxChanges(mode = null) {
          const modes = mode ? [mode] : this.bandModes();
          modes.forEach(m => {
            const newCheckedValues = [];
            this.getBandCheckboxes(m).forEach(cb => { if (cb.checked) newCheckedValues.push(cb.value); });
            this.updatedLockedBandsByMode[m] = newCheckedValues;
          });
          if (mode) {
            this.currentNetworkMode = mode;
            this.updatedLockedBands = this.updatedLockedBandsByMode[mode];
          }
        },

        toggleBandCheckboxes(mode) {
          const selectedMode = String(mode || this.currentNetworkMode || 'LTE').toUpperCase();
          const checkboxes = this.getBandCheckboxes(selectedMode);
          if (checkboxes.length === 0) return;

          let allChecked = true;
          checkboxes.forEach(cb => { if (!cb.checked) allChecked = false; });
          const targetChecked = !allChecked;

          checkboxes.forEach((checkbox) => {
            checkbox.checked = targetChecked;
          });
          this.trackCheckboxChanges(selectedMode);
          updateButtonText(selectedMode);
        },

        async getCurrentSettings() {
          // 如果请求正在进行中，直接返回
          if (this._currentSettingsFetchInFlight) return this._currentSettingsFetchInFlight;

          this._currentSettingsFetchInFlight = SimpleAdmin.Api.networkData({ action: 'settings' })
            .then(settings => {
              this.apn = settings.apn || '-';
              this.cellLockStatus = settings.cellLockStatus || '未知';
              this.lockRadios = settings.cell_lock?.radios || [];
              this.prefNetwork = settings.prefNetwork || '-';
              this.bands = settings.bands || '-';
              this.nrModeControlCurrent = settings.nrModeControlNum || null;
              this.nrModeControlNew = null;
              this.pdpType = settings.pdpType || '-';
              this.pdpContexts = Array.isArray(settings.pdpContexts) ? settings.pdpContexts : [];
              this.imsEnabled = settings.imsEnabled ?? '-';
              this.simHotswapEnabled = settings.simHotswapEnabled ?? '-';
              this.roamPref = settings.roamPref ?? '-';
              this.simSlot = settings.sim || '-';
              this.simSlots = Array.isArray(settings.simSlots) ? settings.simSlots : [];
              this.lteLockInfo = settings.lteLockInfo || '';
              this.nrLockInfo = settings.nrLockInfo || '';
            })
            .finally(() => {
              this._currentSettingsFetchInFlight = null; // 清空请求标记
            });
          return this._currentSettingsFetchInFlight;
        },

        pdpSummaryText() {
          if (!this.pdpContexts.length) return '';
          const active = this.pdpContexts.filter(c => c.active).length;
          return this.pdpContexts.length + ' 个上下文 · ' + active + ' 个已激活';
        },

        featureStateText(value, onText, offText, unknownText) {
          if (value === '1') return onText;
          if (value === '0') return offText;
          return unknownText;
        },

        neighbourEmptyText() {
          return '当前未上报邻区数据。SA 模式下属平台限制（仅 3G/4G/EN-DC 支持邻区扫描），可切换制式后重试。';
        },

        openPdpModal(ctx) {
          this.pdpModalMode = ctx ? 'edit' : 'new';
          this.pdpForm = ctx
            ? {
                cid: ctx.cid,
                pdpType: ['IP', 'IPV6', 'IPV4V6', 'PPP'].includes(ctx.pdpType) ? ctx.pdpType : 'IPV4V6',
                apn: ctx.apn || ''
              }
            : { cid: null, pdpType: 'IPV4V6', apn: '' };
          this.showPdpModal = true;
        },

        async savePdpContext() {
          const cid = Number(this.pdpForm.cid);
          if (!Number.isInteger(cid) || cid < 1 || cid > 32) {
            alert('CID 无效（1-32）');
            return;
          }
          const apn = (this.pdpForm.apn || '').trim();
          if (!apn || !/^[\w.\-]+$/.test(apn)) {
            alert('APN 无效（仅字母数字与 . _ -）');
            return;
          }
          this.pdpBusy = true;
          this.pdpMessage = '';
          try {
            const data = await SimpleAdmin.Api.networkData({
              action: 'save_pdp', cid, pdpType: this.pdpForm.pdpType, apn
            });
            if (data.ok === false) throw new Error(data.error || data.response || '保存失败');
            this.pdpMessage = '已保存 CID ' + cid + ' 的 PDP 上下文';
            this.showPdpModal = false;
            await this.getCurrentSettings();
          } catch (error) {
            alert('保存 PDP 失败：' + (error.message || error));
          } finally {
            this.pdpBusy = false;
          }
        },

        async deletePdpContext(ctx) {
          if (!confirm('确定删除 CID ' + ctx.cid + ' 的 PDP 上下文吗？')) return;
          this.pdpBusy = true;
          this.pdpMessage = '';
          try {
            const data = await SimpleAdmin.Api.networkData({ action: 'delete_pdp', cid: ctx.cid });
            if (data.ok === false) throw new Error(data.error || data.response || '删除失败');
            this.pdpMessage = '已删除 CID ' + ctx.cid + ' 的 PDP 上下文';
            await this.getCurrentSettings();
          } catch (error) {
            alert('删除 PDP 失败：' + (error.message || error));
          } finally {
            this.pdpBusy = false;
          }
        },

        async togglePdpActive(ctx) {
          if (ctx.active &&
              !confirm('确定去激活 CID ' + ctx.cid + '（' + (ctx.apn || '-') + '）吗？正在使用的 PDP 去激活会导致断网！')) {
            return;
          }
          this.pdpBusy = true;
          this.pdpMessage = '';
          try {
            const data = await SimpleAdmin.Api.networkData({
              action: 'set_pdp_active', cid: ctx.cid, enabled: ctx.active ? '0' : '1'
            });
            if (data.ok === false) throw new Error(data.error || data.response || '操作失败');
            this.pdpMessage = 'CID ' + ctx.cid + (ctx.active ? ' 已去激活' : ' 已激活');
            await this.getCurrentSettings();
          } catch (error) {
            alert('PDP 激活操作失败：' + (error.message || error));
          } finally {
            this.pdpBusy = false;
          }
        },

        async toggleFeature(action, next, successText) {
          this.featureBusy = true;
          this.featureMessage = '';
          try {
            const data = await SimpleAdmin.Api.networkData({ action, enabled: next ? '1' : '0' });
            if (data.ok === false) throw new Error(data.error || data.response || '操作失败');
            this.featureMessage = successText;
            await this.getCurrentSettings();
          } catch (error) {
            this.featureMessage = '操作失败：' + (error.message || error);
          } finally {
            this.featureBusy = false;
          }
        },

        async switchSimSlot(slot) {
          if (!confirm('确定切换到卡槽 ' + slot + ' 吗？切换后模组会重新识别 SIM 卡，蜂窝网络将短暂断开并自动重拨。')) return;
          this.featureBusy = true;
          this.featureMessage = '';
          try {
            const data = await SimpleAdmin.Api.networkData({ action: 'set_sim_slot', slot });
            if (data.ok === false) throw new Error(data.error || data.response || '操作失败');
            this.featureMessage = '已切换到卡槽 ' + slot + '，等待 SIM 重新识别';
            await this.getCurrentSettings();
          } catch (error) {
            this.featureMessage = '切换卡槽失败：' + (error.message || error);
          } finally {
            this.featureBusy = false;
          }
        },

        invalidateLockedBands(mode) {
          if (mode === 'GW') {
            this.locked_gw_bands = null;
          } else if (mode === 'LTE') {
            this.locked_lte_bands = null;
          } else if (mode === 'NSA') {
            this.locked_nsa_bands = null;
          } else if (mode === 'SA') {
            this.locked_sa_bands = null;
          }
        },

        async lockSelectedBandsForMode(mode) {
          const selectedMode = String(mode || '').toUpperCase();
          if (!this.bandModes().includes(selectedMode)) {
            alert("频段模式无效");
            return;
          }
          this.trackCheckboxChanges(selectedMode);
          const newCheckedValues = this.updatedLockedBandsByMode[selectedMode] || [];
          if (newCheckedValues.length === 0) {
            alert("没有选中任何频段，请选择至少一个频段！");
            return;
          }
          await SimpleAdmin.Api.networkData({ action: 'lock_bands', mode: selectedMode, values: newCheckedValues.join(':') });
          this.invalidateLockedBands(selectedMode);
          await this.startModalCountdown(3);
          await Promise.all([
            this.getSupportedBands(true, selectedMode),
            this.getCurrentSettings()
          ]);
        },

        async lockSelectedBands() {
          return this.lockSelectedBandsForMode(this.currentNetworkMode || 'LTE');
        },

        // 手动选网（AT 手册 COPS）：选当前运营商无感，选其它会重新搜网（可能短暂断网）
        async selectOperator(mode) {
          let plmn = '';
          if (mode === 'manual') {
            const c = this.selectedCells[0];
            if (!c || !c.plmn) { alert('请先在扫描结果中勾选一个小区（按其运营商选择）'); return; }
            plmn = c.plmn;
            if (!confirm('确定手动选择运营商 ' + c.provider + '（' + plmn + '）吗？\n切换运营商会重新搜网，蜂窝可能短暂断开。'))
              return;
          } else if (!confirm('确定恢复自动选网（COPS=0）吗？')) {
            return;
          }
          this.isLoading = true;
          try {
            const payload = mode === 'manual' ? { action: 'set_operator', mode: 'manual', plmn } : { action: 'set_operator', mode: 'auto' };
            const data = await SimpleAdmin.Api.networkData(payload);
            if (data.ok === false) throw new Error(data.error || data.response || '操作失败');
            alert(mode === 'manual' ? ('已选择 ' + plmn + '，等待模组注册（最长约 1 分钟）') : '已恢复自动选网');
            this.startModalCountdown(5);
          } catch (error) { alert('选网失败：' + (error.message || error)); }
          finally { this.isLoading = false; }
        },

        // modemwebui 对齐：AT+QNWPREFCFG="restore_band" 一键恢复出厂频段配置
        async restoreBandsFactory() {
          if (!confirm('确定恢复出厂频段配置吗？将清除全部频段锁定（含 WCDMA/LTE/NSA/SA 四组）。')) return;
          this.isLoading = true;
          try {
            const data = await SimpleAdmin.Api.networkData({ action: 'restore_bands' });
            if (data.ok === false) throw new Error(data.error || data.response || '操作失败');
            this.locked_gw_bands = this.locked_lte_bands = this.locked_nsa_bands = this.locked_sa_bands = null;
            await this.getSupportedBands(true, 'ALL');
          } catch (error) { alert('恢复出厂频段失败：' + (error.message || error)); }
          finally { this.isLoading = false; }
        },

        async resetBandLocking() {
          const resetPayload = { action: 'reset_bands' };
          this.bandModes().forEach(m => {
            const v = this[m === 'GW' ? 'gw_bands' : m.toLowerCase() + '_bands'];
            if (v) resetPayload[m.toLowerCase()] = v;
          });
          if (!resetPayload.lte && !resetPayload.nsa && !resetPayload.sa) {
            alert("尚未从模组获取到频段数据，无法恢复全部");
            return;
          }
          await SimpleAdmin.Api.networkData(resetPayload);
          this.locked_gw_bands = null;
          this.locked_lte_bands = null;
          this.locked_nsa_bands = null;
          this.locked_sa_bands = null;
          await this.startModalCountdown(3);
          await Promise.all([
            this.getSupportedBands(true, 'ALL'),
            this.getCurrentSettings()
          ]);
        },

        async saveChanges() {
          const newApn = this.newApn;
          const prefNetworkMode = this.prefNetworkMode;

          const payload = { action: 'save_settings' };
          if (this.newPdpType !== null || newApn !== null) {
            payload.pdpType = this.newPdpType || this.pdpType || 'IPV4V6';
            payload.apn = (newApn !== null && newApn !== '') ? newApn : (this.apn !== '-' ? this.apn : '');
          }
          if (this.nrModeControlNew !== null && this.nrModeControlNew !== this.nrModeControlCurrent) {
            payload.nrDisableMode = this.nrModeControlNew;
          }
          if (prefNetworkMode !== null) {
            payload.modePref = prefNetworkMode;
          }
          if (!payload.apn && !payload.modePref && payload.nrDisableMode === undefined) {
            alert("没有做出更改");
            return;
          }
          this.profileMessage = '';
          await SimpleAdmin.Api.networkData(payload);
          this.profileMessage = '已保存';
          await this.startModalCountdown(3);
          //await this.getCurrentSettings();
          await this.init();
        },

        async getModel() {
          if (this.model && this.model !== "-") return this.model;
          if (this._modelFetchInFlight) return this._modelFetchInFlight;

          this._modelFetchInFlight = (async () => {
            let lastData = null;
            for (let attempt = 0; attempt < 4; attempt += 1) {
              const data = await SimpleAdmin.Api.networkData({ action: 'model', force: '1' });
              lastData = data;
              if (data.model && data.model !== '-') {
                this.model = data.model;
                break;
              }
              if (!data.pending && attempt >= 1) break;
              await this.sleep(700);
            }
            if (!this.model || this.model === '-') {
              console.warn("[CGMM] 未解析到有效型号，保留现有 model：", this.model, lastData || {});
            }
            this._modelFetchInFlight = null;
            return this.model;
          })();

          return this._modelFetchInFlight;
        },

        getLteCellCount() {
          if (this.cellNum === null || this.cellNum === undefined || this.cellNum === '') return 0;
          const count = Math.floor(Number(this.cellNum));
          if (!Number.isFinite(count) || count < 1) return 0;
          return Math.min(count, 10);
        },

        hasLteManualCellCount() {
          return this.networkModeCell === "LTE" && this.getLteCellCount() > 0;
        },

        visibleLteCellIndexes() {
          const count = this.getLteCellCount();
          const indexes = [];
          for (let i = 1; i <= count; i += 1) indexes.push(i);
          return indexes;
        },

        getLteManualValue(index, field) {
          const suffix = field === 'pci' ? 'pci' : 'earfcn';
          return this[`${suffix}${index}`] || '';
        },

        setLteManualValue(index, field, value) {
          const suffix = field === 'pci' ? 'pci' : 'earfcn';
          this[`${suffix}${index}`] = value;
        },

        clearLteManualInputsAfter(count) {
          for (let i = count + 1; i <= 10; i += 1) {
            this[`earfcn${i}`] = null;
            this[`pci${i}`] = null;
          }
        },

        resetLteManualInputs() {
          this.cellNum = null;
          this.clearLteManualInputsAfter(0);
        },

        normalizeLteCellCount() {
          if (this.cellNum === null || this.cellNum === undefined || this.cellNum === '') {
            this.cellNum = null;
            this.clearLteManualInputsAfter(0);
            return;
          }

          const count = this.getLteCellCount();
          if (count < 1) {
            this.cellNum = null;
            this.clearLteManualInputsAfter(0);
            return;
          }

          this.cellNum = count;
          this.clearLteManualInputsAfter(count);
        },

        onNetworkModeCellChange(event) {
          const selectedMode = event && event.target ? event.target.value : this.networkModeCell;
          this.networkModeCell = selectedMode;
          if (selectedMode === "LTE") {
            this.resetLteManualInputs();
          }
        },

        getVisibleLteManualPairs(count) {
          const pairs = [];
          for (let i = 1; i <= count; i += 1) {
            const earfcn = String(this[`earfcn${i}`] || '').trim();
            const pci = String(this[`pci${i}`] || '').trim();
            if (!earfcn || !pci) return null;
            pairs.push({ earfcn, pci });
          }
          return pairs;
        },

        async cellLockEnableLTE() {
          const cellNum = this.getLteCellCount();
          if (cellNum < 1) {
            alert("请输入要锁定的小区数量");
            return;
          }

          const pairs = this.getVisibleLteManualPairs(cellNum);
          if (!pairs) {
            alert(`请完整填写 ${cellNum} 组 EARFCN 和 PCI`);
            return;
          }

          await this.requestCellLock({
            action: 'lock_lte_manual',
            cellNum,
            pairs: pairs.map(p => `${p.earfcn},${p.pci}`).join(';')
          });
          await this.startModalCountdown(3);
          //await this.getCurrentSettings();
          await this.init();
        },

        async cellLockEnableNR() {
          const { earfcn1: earfcn, pci1: pci, scs, band } = this;
          if (earfcn === null || pci === null || scs === null || band === null) {
            alert("请输入所有必填字段");
            return;
          }
          await this.requestCellLock({ action: 'lock_nr_manual', pci, earfcn, scs, band });
          await this.startModalCountdown(3);
          //await this.getCurrentSettings();
          await this.init();
        },

        async cellLockDisableLTE() {
          await this.requestCellLock({ action: 'unlock_lte' });
          await this.startModalCountdown(3);
          //await this.getCurrentSettings();
          await this.init();
        },

        async cellLockDisableNR() {
          await this.requestCellLock({ action: 'unlock_nr' });
          await this.startModalCountdown(3);
          //await this.getCurrentSettings();
          await this.init();
        },
      };
    }

    function addCheckboxListeners(cellLock) {
      document.querySelectorAll('input.checkbox-band').forEach(function (checkbox) {
        checkbox.onchange = function () {
          const mode = checkbox.dataset.bandMode;
          cellLock.trackCheckboxChanges(mode);
          updateButtonText(mode);
        };
      });
    }

    // 数字频段串并集（数值序去重）："1:5" ∪ "5:8" = "1:5:8"
    function unionBands(a, b) {
      const set = new Set();
      String(a || '').split(':').concat(String(b || '').split(':')).forEach(v => {
        v = v.trim();
        if (v !== '') set.add(v);
      });
      return [...set].sort((x, y) => {
        const nx = parseInt(x, 10), ny = parseInt(y, 10);
        if (Number.isFinite(nx) && Number.isFinite(ny) && nx !== ny) return nx - ny;
        return x < y ? -1 : (x > y ? 1 : 0);
      }).join(':');
    }

    // 更新每个模式的全选 / 取消选中按钮文本
    function updateButtonText(mode = null) {
      const modes = mode ? [mode] : ['GW', 'LTE', 'NSA', 'SA'];
      modes.forEach((currentMode) => {
        const checkboxes = document.querySelectorAll(`input.checkbox-band[data-band-mode="${currentMode}"]`);
        const button = document.getElementById(`toggleBands${currentMode}`);
        if (!button) return;
        if (checkboxes.length === 0) {
          button.textContent = "全部选中";
          return;
        }
        let allChecked = true;
        checkboxes.forEach(cb => { if (!cb.checked) allChecked = false; });
        button.textContent = allChecked ? "取消选中" : "全部选中";
      });
    }

if (window.SimpleAdminSpaMode) {
  (window.SimpleAdmin.Pages = window.SimpleAdmin.Pages || {}).network = cellLocking;
} else {
  mountSimpleAdminVueApp(cellLocking);
}
