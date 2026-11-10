# simpleadmin

5G 模组网管面板（Rust/axum，预编译 aarch64）在 iStoreOS/OpenWrt 24.10 上的打包仓库。

- 面板：`/usr/bin/simpleadmin-httpd` 0.2.6，监听 `:8088`（HTTP）/`:8443`（HTTPS）
- 前端：`/etc/simpleadmin/www`（SPA），LuCI 只做 iframe 壳：`/admin/simpleadmin/panel`
- 功能页：仪表盘 / SMS / 电话（VoIP + USSD）/ 锁频锁小区 / TTL / 转发 / 终端

## 电话链路

```
phone.js -> /api/voip -> ubus qmodem_voip -> /var/run/qmodem_voip/websocket.sock -> qmodem-voip/sipd
```

必须同时装 QModem 的语音栈，否则电话页报 "voipd media socket unavailable"：

```
CONFIG_PACKAGE_qmodem-voip=y
CONFIG_PACKAGE_qmodem-sipd=y
CONFIG_PACKAGE_luci-app-qmodem-voip=y
CONFIG_PACKAGE_kmod-usb-audio=y
```

## feed 接入

```
src-git simpleadmin https://github.com/guangay/simpleadmin.git;main
```

```
./scripts/feeds update simpleadmin
./scripts/feeds install -a -p simpleadmin
```

## 注意

1. `--no-auth=true`：8088 无鉴权，同网段任何人可控制模组。建议只对 LAN 开放（fw4 规则），
   或改成 `--no-auth=false` 并配置 `/etc/simpleadmin/simpleadmin.auth`。
2. 原 init 里的 `iptables -I INPUT --dport 8088` 在 24.10 的 fw4/nftables 下不生效，
   需要改成 uci firewall 规则或 nft 语句。
3. 二进制为 aarch64 + musl（glibc 依赖通过 libc 兼容层），其他架构不可用。
4. 电话能否真正通话取决于运营商是否给该 SIM 开 VoLTE/语音权限。