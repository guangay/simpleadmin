include $(TOPDIR)/rules.mk

# SimpleAdmin 5G 模组网管面板（Rust/axum，预编译 aarch64 musl 二进制）
# 面板通过 iframe 嵌在 LuCI：/admin/simpleadmin/panel -> http://<ip>:8088
# 电话/SMS/锁频/USSD 均通过 QModem 的 ubus 服务（qmodem_voip / qmodem.sms）完成。

PKG_NAME:=simpleadmin
PKG_VERSION:=0.2.6
PKG_RELEASE:=1
PKG_LICENSE:=Proprietary

include $(INCLUDE_DIR)/package.mk

define Package/simpleadmin
  SECTION:=net
  CATEGORY:=Network
  TITLE:=SimpleAdmin 5G modem panel (prebuilt, aarch64)
  DEPENDS:=@aarch64 +qmodem-voip +qmodem-sipd +alsa-lib +libsoxr \
	+libwebsockets-full +kmod-usb-audio +adb
  PKGARCH:=aarch64_cortex-a53
endef

define Package/simpleadmin/description
  SimpleAdmin 0.2.6 —— 5G 模组管理面板（Rust 实现，监听 :8088/:8443）。
  提供仪表盘、SMS、电话（VoIP/USSD）、锁频/锁小区、TTL、转发、终端等页面。
  电话功能依赖 QModem 的 voipd（ubus qmodem_voip + /var/run/qmodem_voip/websocket.sock）。
endef

define Package/simpleadmin/conffiles
/etc/simpleadmin/at_devices.conf
/etc/simpleadmin/simpleadmin.auth
endef

define Package/simpleadmin/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) ./files/usr/bin/simpleadmin-httpd $(1)/usr/bin/
	$(INSTALL_BIN) ./files/usr/bin/simpleadmin-menu-sync.sh $(1)/usr/bin/

	$(INSTALL_DIR) $(1)/etc/init.d
	$(INSTALL_BIN) ./files/etc/init.d/simpleadmin $(1)/etc/init.d/

	$(INSTALL_DIR) $(1)/etc/simpleadmin
	$(CP) ./files/etc/simpleadmin/. $(1)/etc/simpleadmin/

	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/simpleadmin
	$(CP) ./files/www/luci-static/resources/view/simpleadmin/. $(1)/www/luci-static/resources/view/simpleadmin/

	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d $(1)/usr/share/rpcd/acl.d
	$(CP) ./files/usr/share/luci/menu.d/*.json $(1)/usr/share/luci/menu.d/
	$(CP) ./files/usr/share/rpcd/acl.d/*.json $(1)/usr/share/rpcd/acl.d/
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

define Build/Compile
endef

$(eval $(call BuildPackage,simpleadmin))
