'use strict';
'require view';


return view.extend({
	load: function() {
		// Live modem model (AT+CGMM via the public module_model API).
		return fetch('http://' + window.location.hostname + ':8088/api/module_model')
			.then(function(r) { return r.json(); })
			.then(function(d) { return (d && d.model) || ''; })
			.catch(function() { return ''; });
	},
	render: function(model) {
		var port = '8088';
		var url = 'http://' + window.location.hostname + ':' + port + '/';
		var name = (model && model !== '-') ? model : '5G 模组';
		var nodes = [];
		var frame = E('iframe', {
			'src': url,
			'style': 'width:100%;min-height:640px;height:calc(100dvh - 170px);border:none;border-radius:3px;background:#fff'
		});
		nodes.push(frame);

		// 面板跨域（:80/:8088）无法读取内容高度——由面板 postMessage 上报。
		// 高度 = min(内容高, 可用视口高)：内容超出时 iframe 内部滚动，面板的
		// sticky 顶栏（含菜单按钮/语言/主题）始终可见、侧边栏随时可打开；
		// 内容不足时贴合不留白。外层 LuCI 不滚（iframe ≤ 可用高），无双滚动。
		// 初值保持 viewport 高度防首屏跳变，JS 不可用时回退该默认。
		var lastReportedHeight = 0;
		var applyPanelHeight = function(contentHeight) {
			var rect = frame.getBoundingClientRect();
			var top = rect.top + (window.scrollY || 0);
			var avail = Math.floor(window.innerHeight - top - 8);
			if (avail < 560) avail = 560;
			var height = Math.min(Math.max(560, Math.ceil(contentHeight)), avail);
			frame.style.minHeight = '560px';
			frame.style.height = height + 'px';
		};
		window.addEventListener('message', function(ev) {
			if (!ev || !ev.data)
				return;
			if (ev.data.type === 'simpleadmin:height') {
				var h = Number(ev.data.height);
				if (!isFinite(h) || h <= 0)
					return;
				lastReportedHeight = h;
				applyPanelHeight(h);
			}
			else if (ev.data.type === 'simpleadmin:navigate') {
				// 面板内滚恢复后切页由面板自行归顶；宿主兜底把 iframe 顶带回视口
				frame.scrollIntoView({ block: 'start' });
			}
		});
		window.addEventListener('resize', function() {
			if (lastReportedHeight > 0)
				applyPanelHeight(lastReportedHeight);
		});

		return E('div', {}, nodes);
	},
	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
