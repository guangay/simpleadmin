#!/bin/sh
# 从模组实时取型号（simpleadmin /api/module_model → AT+CGMM），回写 LuCI 菜单标题。
# 幂等：型号未变化或型号无效时不动文件。菜单刷新需清 dispatcher 缓存。
API=http://127.0.0.1:8088/api/module_model
MENU=/usr/share/luci/menu.d/luci-app-simpleadmin.json
[ -f "$MENU" ] || exit 0

MODEL=""
i=0
while [ $i -lt 30 ]; do
	RESP=$(wget -qO- -T 3 "$API" 2>/dev/null)
	MODEL=$(echo "$RESP" | jsonfilter -e '@.model' 2>/dev/null)
	[ -z "$MODEL" ] && MODEL=$(echo "$RESP" | grep -o '"model":"[^"]*"' | cut -d'"' -f4)
	[ -n "$MODEL" ] && [ "$MODEL" != "-" ] && [ "$MODEL" != "SimpleAdmin" ] && break
	MODEL=""
	i=$((i+1))
	sleep 5
done
[ -z "$MODEL" ] && exit 0

LINE=$(sed -n 3p "$MENU")
echo "$LINE" | grep -q '"title"' || exit 0
CURRENT=$(echo "$LINE" | grep -o '"title": "[^"]*"')
NEW="\"title\": \"$MODEL 5G\""
[ "$CURRENT" = "$NEW" ] && exit 0
sed -i "3s/\"title\": \"[^\"]*\"/$NEW/" "$MENU"
rm -f /tmp/luci-indexcache* 2>/dev/null
