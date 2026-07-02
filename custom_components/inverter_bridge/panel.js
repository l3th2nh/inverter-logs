/*
 * Inverter Bridge — panel "Hệ điện mặt trời" (native HA, Shadow DOM).
 * Tham khảo thiết kế inverter_panel + khuôn mẫu panel "Nhà tôi" của dự án bể nước.
 * - Dùng this._hass (states / callService / services) -> KHÔNG cần token.
 * - Lưu cấu hình (ánh xạ cảm biến + thông báo + quy tắc) qua WebSocket Store (đồng bộ mọi nơi).
 * - Sơ đồ dòng năng lượng trực tiếp + thông báo khi lấy điện lưới + quy tắc tự động (+ xuất YAML).
 * Lưu ý: quy tắc/thông báo "chạy trực tiếp" chỉ hoạt động khi panel đang mở -> để 24/7 hãy Xuất YAML.
 */

const STYLE = `<style>
:host{
  --bg:#16141b;--bg-2:#1d1a23;--panel:#221f2b;--panel-2:#2a2633;
  --line:rgba(255,255,255,.08);--line-strong:rgba(255,255,255,.14);
  --text:#f3efe9;--muted:#a59eb4;--faint:#6f6980;
  --solar:#ffb24c;--batt:#5fd29a;--grid-in:#f0676a;--grid-out:#62a8ef;--load:#c9c2d8;
  --danger:#f0676a;--ok:#5fd29a;--radius:18px;--shadow:0 10px 40px -18px rgba(0,0,0,.7);
  display:block;min-height:100vh;color:var(--text);
  font-family:'Inter',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-font-smoothing:antialiased;
  background:
    radial-gradient(1100px 600px at 82% -12%, rgba(240,103,106,.10), transparent 60%),
    radial-gradient(900px 520px at 0% 108%, rgba(255,178,76,.07), transparent 55%),
    var(--bg);
}
*{box-sizing:border-box}
.wrap{max-width:1000px;margin:0 auto;padding:16px 18px 90px}
.topbar{display:flex;align-items:center;gap:12px;margin-bottom:18px}
.brand{display:flex;flex-direction:column;gap:2px;margin-right:auto}
.brand h1{font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:21px;letter-spacing:-.02em;margin:0;line-height:1}
.brand .sub{font-size:12.5px;color:var(--faint)}
.icon-btn{width:42px;height:42px;border-radius:12px;flex:none;background:var(--panel);border:1px solid var(--line);
  color:var(--muted);display:grid;place-items:center;cursor:pointer;transition:.2s}
.icon-btn:hover{border-color:var(--line-strong);color:var(--text)}
.icon-btn svg{width:20px;height:20px}
@keyframes pulse{50%{opacity:.35}}
.hero{background:linear-gradient(180deg,var(--bg-2),var(--panel));border:1px solid var(--line);border-radius:22px;
  padding:20px 20px 8px;box-shadow:var(--shadow);margin-bottom:18px;overflow:hidden;position:relative}
.hero-head{display:flex;align-items:center;gap:12px;margin-bottom:6px;flex-wrap:wrap}
.grid-badge{display:inline-flex;align-items:center;gap:9px;padding:9px 15px;border-radius:14px;font-weight:600;font-size:14.5px;
  letter-spacing:-.01em;border:1px solid var(--line-strong);background:var(--panel-2);color:var(--muted);transition:.3s}
.grid-badge .bdot{width:9px;height:9px;border-radius:50%;background:var(--faint);flex:none;transition:.3s}
.grid-badge b{font-family:'JetBrains Mono',monospace;font-weight:600}
.grid-badge.importing{border-color:color-mix(in srgb,var(--grid-in) 55%,var(--line));
  background:color-mix(in srgb,var(--grid-in) 14%,var(--panel-2));color:color-mix(in srgb,var(--grid-in) 80%,var(--text));
  box-shadow:0 0 0 1px color-mix(in srgb,var(--grid-in) 30%,transparent) inset,0 0 26px -10px var(--grid-in)}
.grid-badge.importing .bdot{background:var(--grid-in);box-shadow:0 0 10px var(--grid-in);animation:pulse 1.2s infinite}
.grid-badge.exporting{border-color:color-mix(in srgb,var(--grid-out) 50%,var(--line));
  background:color-mix(in srgb,var(--grid-out) 12%,var(--panel-2));color:color-mix(in srgb,var(--grid-out) 80%,var(--text))}
.grid-badge.exporting .bdot{background:var(--grid-out);box-shadow:0 0 10px var(--grid-out)}
.grid-badge.self .bdot{background:var(--batt);box-shadow:0 0 10px var(--batt)}
.hero-head .refreshed{margin-left:auto;font-size:11.5px;color:var(--faint);font-family:'JetBrains Mono',monospace}
.flow-wrap{position:relative;width:100%;height:300px;margin:4px auto 0;max-width:520px}
.flow-wrap svg{position:absolute;inset:0;width:100%;height:100%}
.edge{fill:none;stroke:var(--line-strong);stroke-width:2.5;stroke-linecap:round;vector-effect:non-scaling-stroke;opacity:.55;transition:opacity .3s}
.edge.active{stroke-dasharray:5 9;animation:dash 1s linear infinite;opacity:1}
@keyframes dash{to{stroke-dashoffset:-14}}
.node{position:absolute;transform:translate(-50%,-50%);text-align:center;width:104px}
.node .disc{width:62px;height:62px;border-radius:18px;margin:0 auto 8px;display:flex;align-items:center;justify-content:center;
  line-height:0;background:var(--panel-2);border:1px solid var(--line);color:var(--faint);position:relative;transition:.3s}
.node .disc svg{width:28px;height:28px;display:block;position:relative;top:0;left:0}
.node.on .disc{color:var(--nc);border-color:color-mix(in srgb,var(--nc) 45%,transparent);
  background:color-mix(in srgb,var(--nc) 12%,var(--panel-2));box-shadow:0 0 22px -8px var(--nc)}
.node .nlabel{font-size:11.5px;color:var(--faint);font-weight:500}
.node .nval{font-family:'JetBrains Mono',monospace;font-weight:600;font-size:15px;color:var(--text);margin-top:1px;letter-spacing:-.02em}
.node .nsub{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--faint);margin-top:1px}
.n-pv{left:50%;top:15%;--nc:var(--solar)}
.n-grid{left:15%;top:50%;--nc:var(--grid-in)}
.n-batt{left:85%;top:50%;--nc:var(--batt)}
.n-load{left:50%;top:85%;--nc:var(--load)}
.n-hub{left:50%;top:50%;width:auto}
.hub-core{width:36px;height:36px;border-radius:11px;display:flex;align-items:center;justify-content:center;line-height:0;
  background:var(--panel);border:1px solid var(--line-strong);color:var(--muted);box-shadow:var(--shadow)}
.hub-core svg{width:18px;height:18px;display:block;position:relative;top:0;left:0}
.seg{display:flex;gap:6px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:5px;margin-bottom:20px;max-width:460px}
.seg button{flex:1;border:none;background:transparent;color:var(--muted);cursor:pointer;font-family:inherit;font-weight:500;
  font-size:14px;padding:10px 8px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;gap:8px;transition:.18s}
.seg button svg{width:16px;height:16px}
.seg button:hover{color:var(--text)}
.seg button.active{background:var(--panel-2);color:var(--text);box-shadow:0 0 0 1px var(--line-strong) inset}
.panel-view{display:none}
.panel-view.show{display:block;animation:fade .25s ease}
@keyframes fade{from{opacity:0;transform:translateY(6px)}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--radius);padding:20px;margin-bottom:16px}
.card > .c-head{display:flex;align-items:flex-start;gap:12px;margin-bottom:4px}
.c-head .c-ic{width:40px;height:40px;border-radius:12px;flex:none;line-height:0;display:flex;align-items:center;justify-content:center;
  background:var(--panel-2);border:1px solid var(--line);color:var(--muted)}
.c-head .c-ic svg{width:20px;height:20px;display:block}
.c-head .c-tt{flex:1;min-width:0}
.c-head h3{font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:16.5px;margin:0;letter-spacing:-.01em}
.c-head p{margin:3px 0 0;font-size:13px;color:var(--faint);line-height:1.5}
.divider{height:1px;background:var(--line);margin:16px 0}
.settings-body.collapsed{display:none}
.row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:11px 0}
.row + .row{border-top:1px solid var(--line)}
.row .rl{min-width:0}
.row .rl .k{font-size:14px;font-weight:500}
.row .rl .d{font-size:12px;color:var(--faint);margin-top:2px;line-height:1.45}
.row .rc{flex:none;display:flex;align-items:center;gap:8px}
.switch{--w:50px;width:var(--w);height:29px;border-radius:999px;flex:none;cursor:pointer;background:var(--panel-2);
  border:1px solid var(--line-strong);position:relative;transition:.28s}
.switch .knob{position:absolute;top:2px;left:2px;width:23px;height:23px;border-radius:50%;background:var(--faint);transition:.28s cubic-bezier(.34,1.56,.64,1)}
.switch.on{background:color-mix(in srgb,var(--ok) 32%,var(--panel-2));border-color:var(--ok)}
.switch.on .knob{left:calc(var(--w) - 25px);background:var(--ok);box-shadow:0 0 12px var(--ok)}
.num{display:inline-flex;align-items:center;background:var(--panel-2);border:1px solid var(--line-strong);border-radius:11px;overflow:hidden}
.num input{width:64px;border:none;background:transparent;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:14px;
  font-weight:500;padding:9px 4px 9px 11px;outline:none;text-align:right}
.num .unit{font-size:12px;color:var(--faint);padding:0 11px 0 5px}
select.sel{background:var(--panel-2);border:1px solid var(--line-strong);color:var(--text);font-family:inherit;font-size:13.5px;
  padding:9px 12px;border-radius:11px;outline:none;cursor:pointer;max-width:240px}
select.sel:focus,.num:focus-within{border-color:var(--grid-out)}
.btn{display:inline-flex;align-items:center;gap:8px;padding:10px 15px;border-radius:12px;font-weight:500;font-size:14px;cursor:pointer;
  border:1px solid var(--line);background:var(--panel);color:var(--text);transition:.18s;font-family:inherit}
.btn:hover{border-color:var(--line-strong)}
.btn svg{width:16px;height:16px}
.btn.primary{background:var(--text);color:#1a1820;border-color:transparent;font-weight:600}
.btn.primary:hover{opacity:.9}
.btn.ghost{background:transparent}
.btn.tiny{padding:7px 11px;font-size:13px;border-radius:10px}
.live-chip{display:inline-flex;align-items:center;gap:7px;font-size:12.5px;font-weight:500;padding:7px 12px;border-radius:999px;
  background:var(--panel-2);border:1px solid var(--line);color:var(--muted)}
.live-chip .bdot{width:8px;height:8px;border-radius:50%;background:var(--faint)}
.live-chip.hot{color:color-mix(in srgb,var(--grid-in) 85%,var(--text));border-color:color-mix(in srgb,var(--grid-in) 40%,var(--line))}
.live-chip.hot .bdot{background:var(--grid-in);box-shadow:0 0 8px var(--grid-in)}
.live-chip.cool{color:color-mix(in srgb,var(--batt) 85%,var(--text));border-color:color-mix(in srgb,var(--batt) 40%,var(--line))}
.live-chip.cool .bdot{background:var(--batt);box-shadow:0 0 8px var(--batt)}
.notif-preview{margin-top:14px;background:var(--panel-2);border:1px solid var(--line);border-radius:14px;padding:14px;display:flex;gap:12px;align-items:flex-start}
.notif-preview .np-ic{width:36px;height:36px;border-radius:11px;flex:none;line-height:0;display:flex;align-items:center;justify-content:center;
  background:color-mix(in srgb,var(--grid-in) 16%,var(--panel));color:var(--grid-in)}
.notif-preview .np-ic svg{width:19px;height:19px;display:block}
.notif-preview .np-t{font-weight:600;font-size:14px;margin-bottom:2px}
.notif-preview .np-m{font-size:13px;color:var(--muted);line-height:1.5}
.notif-preview .np-tag{font-size:10.5px;color:var(--faint);margin-top:6px;font-family:'JetBrains Mono',monospace}
.msg-input{width:100%;padding:11px 13px;border-radius:11px;font-size:14px;font-family:inherit;background:var(--panel-2);
  border:1px solid var(--line-strong);color:var(--text);outline:none;resize:vertical;min-height:44px}
.msg-input:focus{border-color:var(--grid-out)}
.placeholders{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.placeholders code{font-family:'JetBrains Mono',monospace;font-size:11px;background:var(--panel-2);border:1px solid var(--line);
  color:var(--muted);padding:3px 7px;border-radius:7px;cursor:pointer;transition:.15s}
.placeholders code:hover{border-color:var(--line-strong);color:var(--text)}
.rules-head{display:flex;align-items:center;gap:12px;margin-bottom:14px;flex-wrap:wrap}
.rules-head h2{font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:18px;margin:0;letter-spacing:-.01em}
.rules-head .meta{font-size:13px;color:var(--faint);margin-right:auto}
.rule{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px 16px 14px;margin-bottom:12px;transition:border-color .25s,box-shadow .3s}
.rule.enabled{border-color:color-mix(in srgb,var(--grid-in) 28%,var(--line))}
.rule.armed{box-shadow:0 0 0 1px color-mix(in srgb,var(--grid-in) 35%,transparent) inset,0 0 26px -12px var(--grid-in)}
.rule-top{display:flex;align-items:center;gap:12px}
.rule-name{font-weight:600;font-size:15.5px;flex:1;min-width:0;letter-spacing:-.01em}
.rule-when,.rule-then{display:flex;align-items:flex-start;gap:10px;font-size:13.5px;line-height:1.5;margin-top:11px}
.rule-tag{font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;letter-spacing:.04em;padding:3px 7px;border-radius:7px;flex:none;margin-top:1px}
.rule-tag.when{background:color-mix(in srgb,var(--grid-in) 16%,var(--panel-2));color:var(--grid-in)}
.rule-tag.then{background:color-mix(in srgb,var(--batt) 16%,var(--panel-2));color:var(--batt)}
.rule-body{color:var(--muted)}
.rule-body b{color:var(--text);font-weight:600}
.chiplist{display:inline-flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.chiplist span{font-size:12px;background:var(--panel-2);border:1px solid var(--line);color:var(--muted);padding:3px 9px;border-radius:8px}
.rule-actions{display:flex;gap:4px}
.rk{width:30px;height:30px;border-radius:9px;border:none;background:transparent;color:var(--faint);cursor:pointer;display:grid;place-items:center;transition:.15s}
.rk:hover{background:var(--panel-2);color:var(--text)}
.rk svg{width:17px;height:17px}
.rk.danger:hover{color:var(--danger)}
.empty{text-align:center;padding:44px 20px;color:var(--faint)}
.empty h3{font-family:'Space Grotesk',sans-serif;color:var(--muted);font-weight:600;margin:0 0 8px}
.empty p{margin:0 0 20px;font-size:14px;line-height:1.55}
.hint-box{background:color-mix(in srgb,var(--grid-out) 8%,var(--panel));border:1px solid color-mix(in srgb,var(--grid-out) 22%,var(--line));
  border-radius:13px;padding:13px 15px;font-size:12.5px;color:var(--muted);line-height:1.6;display:flex;gap:11px}
.hint-box .hb-ic{color:var(--grid-out);flex:none;margin-top:1px}
.hint-box .hb-ic svg{width:17px;height:17px}
.hint-box b{color:var(--text)}
.scrim{position:fixed;inset:0;background:rgba(8,7,11,.66);backdrop-filter:blur(4px);display:none;align-items:center;justify-content:center;padding:20px;z-index:50}
.scrim.show{display:flex}
.modal{width:100%;max-width:480px;background:var(--bg-2);border:1px solid var(--line-strong);border-radius:20px;box-shadow:var(--shadow);
  padding:24px;animation:pop .22s ease;max-height:88vh;overflow-y:auto}
.modal.wide{max-width:640px}
@keyframes pop{from{transform:translateY(12px) scale(.98);opacity:0}}
.modal h3{font-family:'Space Grotesk',sans-serif;font-weight:600;font-size:18px;margin:0 0 4px}
.modal .desc{font-size:13px;color:var(--faint);margin:0 0 20px;line-height:1.5}
.field{margin-bottom:16px}
.field > label{display:block;font-size:13px;color:var(--muted);font-weight:500;margin-bottom:7px}
.field input[type=text],.field input[type=number],.field select{width:100%;padding:12px 13px;border-radius:11px;font-size:14.5px;
  font-family:inherit;background:var(--panel);border:1px solid var(--line-strong);color:var(--text);outline:none;transition:.2s}
.field input:focus,.field select:focus{border-color:var(--grid-out)}
.field .hint{font-size:11.5px;color:var(--faint);margin-top:6px;line-height:1.45}
.pick{display:grid;gap:8px}
.pick.cols2{grid-template-columns:1fr 1fr}
.pick .opt{border:1px solid var(--line-strong);border-radius:12px;padding:12px 13px;cursor:pointer;transition:.18s;color:var(--muted);
  background:var(--panel);display:flex;align-items:center;gap:11px;font-size:13.5px}
.pick .opt svg{width:20px;height:20px;color:var(--faint);flex:none;transition:.2s}
.pick .opt .ot{font-weight:500}
.pick .opt .od{font-size:11.5px;color:var(--faint);margin-top:2px}
.pick .opt:hover{border-color:var(--line-strong)}
.pick .opt.sel{border-color:var(--grid-in);color:var(--text);background:color-mix(in srgb,var(--grid-in) 8%,var(--panel))}
.pick .opt.sel svg{color:var(--grid-in)}
.pick.act .opt.sel{border-color:var(--batt);background:color-mix(in srgb,var(--batt) 8%,var(--panel))}
.pick.act .opt.sel svg{color:var(--batt)}
.seg-in{display:flex;gap:6px;background:var(--panel);border:1px solid var(--line-strong);border-radius:11px;padding:4px}
.seg-in button{flex:1;border:none;background:transparent;color:var(--muted);font-family:inherit;font-size:13px;font-weight:500;
  padding:9px 6px;border-radius:8px;cursor:pointer;transition:.15s}
.seg-in button.active{background:var(--panel-2);color:var(--text);box-shadow:0 0 0 1px var(--line-strong) inset}
.dev-list{max-height:220px;overflow-y:auto;display:grid;gap:7px;padding-right:4px;scrollbar-width:thin}
.dev-list::-webkit-scrollbar{width:6px}
.dev-list::-webkit-scrollbar-thumb{background:var(--line-strong);border-radius:6px}
.dev-opt{display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:11px;cursor:pointer;border:1px solid var(--line);background:var(--panel);transition:.15s}
.dev-opt:hover{border-color:var(--line-strong)}
.dev-opt.on{border-color:color-mix(in srgb,var(--batt) 45%,var(--line));background:color-mix(in srgb,var(--batt) 8%,var(--panel))}
.dev-check{width:20px;height:20px;border-radius:6px;border:1.5px solid var(--line-strong);flex:none;display:grid;place-items:center;transition:.15s;color:transparent}
.dev-opt.on .dev-check{background:var(--batt);border-color:var(--batt);color:#12261c}
.dev-check svg{width:13px;height:13px}
.dev-opt .dn{font-size:14px;font-weight:500}
.dev-opt .de{font-family:'JetBrains Mono',monospace;font-size:10.5px;color:var(--faint);margin-top:1px}
.modal-actions{display:flex;gap:10px;margin-top:22px}
.modal-actions .btn{flex:1;justify-content:center}
.del-link{background:none;border:none;color:var(--danger);font-size:13px;cursor:pointer;padding:8px 0;margin-top:4px;font-family:inherit}
.del-link:hover{text-decoration:underline}
.map-live{font-size:11.5px;font-family:'JetBrains Mono',monospace;color:var(--faint);margin-top:6px}
.map-live b{color:var(--text)}
.yaml{background:#100e15;border:1px solid var(--line-strong);border-radius:12px;padding:14px 16px;font-family:'JetBrains Mono',monospace;
  font-size:12px;line-height:1.65;color:#cfc8dc;white-space:pre;overflow-x:auto;max-height:52vh;overflow-y:auto}
.toasts{position:fixed;top:18px;right:18px;z-index:80;display:flex;flex-direction:column;gap:10px;max-width:340px}
.toast{background:var(--bg-2);border:1px solid var(--line-strong);border-radius:14px;padding:13px 15px;box-shadow:var(--shadow);
  display:flex;gap:12px;align-items:flex-start;animation:slidein .25s ease;border-left-width:3px}
@keyframes slidein{from{transform:translateX(30px);opacity:0}}
.toast.out{animation:slideout .3s ease forwards}
@keyframes slideout{to{transform:translateX(30px);opacity:0}}
.toast.alert{border-left-color:var(--grid-in)}.toast.action{border-left-color:var(--solar)}.toast.ok{border-left-color:var(--ok)}
.toast .t-ic{flex:none;margin-top:1px}
.toast.alert .t-ic{color:var(--grid-in)}.toast.action .t-ic{color:var(--solar)}.toast.ok .t-ic{color:var(--ok)}
.toast .t-ic svg{width:19px;height:19px}
.toast .t-t{font-weight:600;font-size:13.5px}
.toast .t-m{font-size:12.5px;color:var(--muted);margin-top:2px;line-height:1.45}
@media (max-width:560px){.wrap{padding:14px 12px 80px}.flow-wrap{height:280px}.node{width:88px}.seg{max-width:none}.modal{padding:20px}.pick.cols2{grid-template-columns:1fr}}
</style>`;

const SHELL = `
<div class="wrap">
  <div class="topbar">
    <button class="icon-btn" id="menuBtn" title="Menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 6h18M3 12h18M3 18h18"/></svg></button>
    <div class="brand"><h1>Hệ điện mặt trời</h1><span class="sub">Giám sát biến tần · thông báo · tự động hóa</span></div>
    <button class="icon-btn" id="settingsBtn" title="Ánh xạ cảm biến"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
  </div>
  <div class="hero">
    <div class="hero-head">
      <div class="grid-badge" id="gridBadge"><span class="bdot"></span><span id="gridBadgeTxt">Đang đọc…</span></div>
      <span class="refreshed" id="refreshed"></span>
    </div>
    <div class="flow-wrap">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none">
        <line class="edge" id="e-pv" x1="50" y1="18" x2="50" y2="47"></line>
        <line class="edge" id="e-grid" x1="18" y1="50" x2="47" y2="50"></line>
        <line class="edge" id="e-batt" x1="53" y1="50" x2="82" y2="50"></line>
        <line class="edge" id="e-load" x1="50" y1="53" x2="50" y2="82"></line>
      </svg>
      <div class="node n-pv" id="nodePv"><div class="disc"></div><div class="nlabel">Điện mặt trời</div><div class="nval" id="vPv">– W</div></div>
      <div class="node n-grid" id="nodeGrid"><div class="disc"></div><div class="nlabel">Lưới điện</div><div class="nval" id="vGrid">– W</div><div class="nsub" id="vGridSub"></div></div>
      <div class="node n-batt" id="nodeBatt"><div class="disc"></div><div class="nlabel">Pin lưu trữ</div><div class="nval" id="vBatt">– %</div><div class="nsub" id="vBattSub"></div></div>
      <div class="node n-load" id="nodeLoad"><div class="disc"></div><div class="nlabel">Tải trong nhà</div><div class="nval" id="vLoad">– W</div></div>
      <div class="node n-hub"><div class="hub-core" id="hubCore"></div></div>
    </div>
  </div>
  <div class="seg" id="seg">
    <button data-p="notif" class="active"></button>
    <button data-p="auto"></button>
  </div>
  <div class="panel-view show" id="panel-notif">
    <div class="card">
      <div class="c-head">
        <div class="c-ic" id="notifHeadIc"></div>
        <div class="c-tt"><h3>Thông báo khi bắt đầu lấy điện lưới</h3>
          <p>Gửi thông báo ngay khi hệ chuyển từ tự cấp (mặt trời + pin) sang phải nhập điện từ lưới.</p></div>
        <div class="switch" id="notifToggle"><div class="knob"></div></div>
      </div>
      <div style="margin-top:12px"><span class="live-chip" id="notifLiveChip"><span class="bdot"></span><span id="notifLiveTxt">–</span></span></div>
      <div class="settings-body" id="notifBody">
        <div class="divider"></div>
        <div class="row"><div class="rl"><div class="k">Ngưỡng bỏ qua nhiễu</div><div class="d">Chỉ báo khi công suất nhập vượt mức này — tránh báo khi mây thoáng qua.</div></div>
          <div class="rc"><div class="num"><input type="number" id="nfThreshold" min="0" step="10" value="50"><span class="unit">W</span></div></div></div>
        <div class="row"><div class="rl"><div class="k">Phải kéo dài</div><div class="d">Trạng thái lấy lưới phải duy trì đủ lâu mới báo.</div></div>
          <div class="rc"><select class="sel" id="nfFor"><option value="0">Ngay lập tức</option><option value="10">10 giây</option><option value="30" selected>30 giây</option><option value="60">1 phút</option><option value="120">2 phút</option></select></div></div>
        <div class="row"><div class="rl"><div class="k">Nghỉ giữa 2 lần báo</div><div class="d">Khoảng thời gian tối thiểu trước khi báo lại.</div></div>
          <div class="rc"><select class="sel" id="nfCooldown"><option value="0">Không giới hạn</option><option value="300" selected>5 phút</option><option value="600">10 phút</option><option value="1800">30 phút</option><option value="3600">1 giờ</option></select></div></div>
        <div class="row"><div class="rl"><div class="k">Gửi tới</div><div class="d">Dịch vụ notify trong Home Assistant.</div></div>
          <div class="rc"><select class="sel" id="nfService"></select></div></div>
        <div class="row"><div class="rl"><div class="k">Báo cả khi ngừng lấy lưới</div><div class="d">Thông báo lần nữa khi hệ tự cấp lại.</div></div>
          <div class="rc"><div class="switch" id="nfStopToggle"><div class="knob"></div></div></div></div>
        <div class="divider"></div>
        <label style="display:block;font-size:13px;color:var(--muted);font-weight:500;margin-bottom:7px">Nội dung thông báo</label>
        <textarea class="msg-input" id="nfMessage">Hệ đang lấy {power} từ lưới (PV {pv}, pin {soc}). Lúc {time}.</textarea>
        <div class="placeholders" id="phList"></div>
        <div class="notif-preview"><div class="np-ic"></div><div style="min-width:0">
          <div class="np-t">Cảnh báo điện lưới</div><div class="np-m" id="pvMsg"></div><div class="np-tag" id="pvTag"></div></div></div>
        <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap">
          <button class="btn tiny" id="nfTestBtn"></button><button class="btn tiny" id="nfYamlBtn"></button></div>
      </div>
    </div>
    <div class="hint-box"><span class="hb-ic"></span>
      <div><b>Chạy trực tiếp trên trang</b> hoạt động khi tab này đang mở — tốt để thử ngay. Để chạy ổn định 24/7 kể cả khi tắt trình duyệt, bấm <b>Xuất YAML</b> rồi dán vào <code>automations.yaml</code> của Home Assistant.</div></div>
  </div>
  <div class="panel-view" id="panel-auto">
    <div class="rules-head"><h2>Quy tắc tự động</h2><span class="meta" id="rulesMeta"></span>
      <button class="btn tiny" id="rulesYamlBtn"></button><button class="btn tiny primary" id="addRuleBtn"></button></div>
    <div id="rulesList"></div>
    <div class="hint-box" style="margin-top:4px"><span class="hb-ic"></span>
      <div>Mỗi quy tắc theo cấu trúc <b>KHI</b> điều kiện xảy ra <b>THÌ</b> tắt/bật thiết bị. Chạy thử ngay trên trang, hoặc <b>Xuất YAML</b> để Home Assistant chạy nền.</div></div>
  </div>
</div>

<div class="scrim" id="ruleModal"><div class="modal wide">
  <h3 id="ruleModalTitle">Thêm quy tắc</h3>
  <p class="desc">Chọn điều kiện kích hoạt và thiết bị cần điều khiển.</p>
  <div class="field"><label>Tên quy tắc</label><input type="text" id="ruName" placeholder="VD: Tắt bình nóng lạnh khi lấy lưới" autocomplete="off"></div>
  <div class="field"><label>KHI — điều kiện kích hoạt</label><div class="pick" id="trigPick"></div></div>
  <div class="field" id="threshField"><label id="threshLabel">Ngưỡng</label>
    <div class="num" style="width:100%"><input type="number" id="ruThresh" style="width:100%;text-align:left"><span class="unit" id="threshUnit">W</span></div>
    <div class="hint" id="threshHint"></div></div>
  <div class="field"><label>Phải kéo dài</label>
    <div class="seg-in" id="ruForSeg"><button data-v="0">Ngay</button><button data-v="10">10s</button><button data-v="30" class="active">30s</button><button data-v="60">1 phút</button><button data-v="120">2 phút</button></div></div>
  <div class="field"><label>THÌ — hành động</label>
    <div class="pick act cols2" id="actPick"><div class="opt sel" data-a="turn_off"><span></span><div><div class="ot">Tắt thiết bị</div></div></div>
      <div class="opt" data-a="turn_on"><span></span><div><div class="ot">Bật thiết bị</div></div></div></div></div>
  <div class="field"><label id="devLabel">Chọn thiết bị (<span id="devCount">0</span>)</label><div class="dev-list" id="ruDevList"></div><div class="hint" id="devHint"></div></div>
  <div class="field"><label>Nghỉ giữa 2 lần chạy</label>
    <div class="seg-in" id="ruCoolSeg"><button data-v="0">Không</button><button data-v="300" class="active">5 phút</button><button data-v="600">10 phút</button><button data-v="1800">30 phút</button></div></div>
  <button class="del-link" id="ruDelBtn" style="display:none">Xóa quy tắc này</button>
  <div class="modal-actions"><button class="btn ghost" data-close>Hủy</button><button class="btn primary" id="ruSaveBtn">Lưu quy tắc</button></div>
</div></div>

<div class="scrim" id="mapModal"><div class="modal">
  <h3>Ánh xạ cảm biến biến tần</h3>
  <p class="desc">Chọn cảm biến tương ứng. Mặc định đã trỏ tới thiết bị Inverter Bridge (sensor.ib_*).</p>
  <div class="field"><label>Công suất lưới <span style="color:var(--grid-in)">*</span></label>
    <select class="sel" id="mapGrid" style="max-width:none;width:100%"></select><div class="map-live" id="mapGridLive"></div></div>
  <div class="field"><label>Chiều dương của cảm biến lưới</label>
    <div class="seg-in" id="signSeg"><button data-v="import_pos" class="active">Dương = NHẬP từ lưới</button><button data-v="export_pos">Dương = BÁN lên lưới</button></div>
    <div class="hint">Xem giá trị trực tiếp phía trên: nếu lúc đang lấy lưới mà số đó dương → chọn "Dương = NHẬP".</div></div>
  <div class="field"><label>SoC pin (%)</label><select class="sel" id="mapSoc" style="max-width:none;width:100%"></select></div>
  <div class="field"><label>Công suất pin (W) <span style="color:var(--faint)">— tùy chọn</span></label><select class="sel" id="mapBatt" style="max-width:none;width:100%"></select></div>
  <div class="field"><label>Công suất PV (W) <span style="color:var(--faint)">— tùy chọn</span></label><select class="sel" id="mapPv" style="max-width:none;width:100%"></select></div>
  <div class="field"><label>Tải tiêu thụ (W) <span style="color:var(--faint)">— tùy chọn</span></label><select class="sel" id="mapLoad" style="max-width:none;width:100%"></select></div>
  <div class="modal-actions"><button class="btn ghost" data-close>Hủy</button><button class="btn primary" id="mapSaveBtn">Lưu</button></div>
</div></div>

<div class="scrim" id="yamlModal"><div class="modal wide">
  <h3 id="yamlTitle">Cấu hình Home Assistant</h3>
  <p class="desc">Dán vào <code style="font-family:'JetBrains Mono',monospace;background:var(--panel);padding:1px 5px;border-radius:5px">automations.yaml</code> rồi Developer Tools → YAML → Reload Automations.</p>
  <div class="yaml" id="yamlOut"></div>
  <div class="modal-actions"><button class="btn ghost" data-close>Đóng</button><button class="btn primary" id="copyYamlBtn"></button></div>
</div></div>

<div class="toasts" id="toasts"></div>`;

const TRIGGERS = {
  grid_import_start:{ label:'Bắt đầu lấy điện lưới', desc:'Chuyển từ tự cấp sang nhập lưới', unit:'W', tlabel:'Ngưỡng bỏ qua nhiễu', def:50, thint:'Chỉ tính là "lấy lưới" khi công suất nhập vượt mức này.' },
  grid_import_above:{ label:'Công suất nhập lưới vượt', desc:'Nhập từ lưới cao hơn ngưỡng', unit:'W', tlabel:'Công suất nhập trên', def:800, thint:'Dùng khi chỉ muốn cắt tải lúc nhập lưới nhiều.' },
  battery_below:{ label:'SoC pin xuống dưới', desc:'Pin còn ít hơn ngưỡng', unit:'%', tlabel:'SoC dưới', def:30, thint:'Bảo vệ pin: cắt tải khi pin gần cạn.' },
  pv_below:{ label:'Điện mặt trời thấp hơn', desc:'PV phát yếu hơn ngưỡng', unit:'W', tlabel:'PV dưới', def:200, thint:'VD: trời tối / cuối ngày.' },
  load_above:{ label:'Tải tiêu thụ vượt', desc:'Nhà đang dùng nhiều hơn ngưỡng', unit:'W', tlabel:'Tải trên', def:2500, thint:'Cắt bớt thiết bị khi quá tải.' }
};

function icon(n){
  const m={
    plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
    pencil:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m12 20 9-9-3-3-9 9V20zM15 8l3 3"/></svg>',
    trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
    bell:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    bolt:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M13 2 3 14h7l-1 8 10-12h-7z"/></svg>',
    power:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3v9M18.4 6.6a9 9 0 1 1-12.8 0"/></svg>',
    check:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 6 9 17l-5-5"/></svg>',
    copy:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    code:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/></svg>',
    info:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/></svg>'
  };
  return m[n]||'';
}
function triIcon(k){
  const A='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">';
  const sun=A+'<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M18.5 5.5l-1.4 1.4M5.5 18.5l1.4-1.4"/></svg>';
  const grid=A+'<path d="M7 21 10.5 4h3L17 21"/><path d="M5.5 21h4M14.5 21h4"/><path d="M12 4V2"/><path d="M6 7h12M8 10h8"/><path d="M9.6 13l4.8 4M14.4 13l-4.8 4"/></svg>';
  const batt=A+'<rect x="7" y="6" width="10" height="15.4" rx="2.2"/><path d="M9.8 2.6h4.4v3.4H9.8z"/><path d="M12.7 9.4 10.4 13.3h3.1l-2.2 3.9" stroke-width="1.4"/></svg>';
  const load=A+'<path d="M3.6 11.3 12 4l8.4 7.3"/><path d="M5.9 10.2v9.3h12.2v-9.3"/><path d="M10 19.5V15h4v4.5"/></svg>';
  return { grid_import_start:grid, grid_import_above:grid, battery_below:batt, pv_below:sun, load_above:load }[k]||grid;
}
function esc(s){ return String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

class SolarInverterPanel extends HTMLElement {
  set hass(h){ this._hass=h; if(!this._built) return; if(!this._ready) this._boot(); else this._onHass(); }
  set narrow(_n){} set route(_r){} set panel(_p){}

  connectedCallback(){
    if(this._built) return;
    this._built=true;
    this.attachShadow({mode:'open'});
    this.shadowRoot.innerHTML = STYLE + SHELL;
    if(this._hass) this._boot();
  }
  disconnectedCallback(){}

  _boot(){
    if(this._ready || this._booting) return;
    this._booting=true;
    const self=this, root=this.shadowRoot;
    const g=(id)=>root.querySelector('#'+id);
    const qsa=(sel)=>root.querySelectorAll(sel);

    const state = {
      map:{ grid:'sensor.ib_grid_power', gridSign:'import_pos', soc:'sensor.ib_battery_soc',
            batt:'sensor.ib_battery_power', pv:'sensor.ib_pv_power', load:'sensor.ib_house_load_power' },
      notif:{ enabled:false, threshold:50, forSec:30, cooldownSec:300, service:'persistent_notification.create',
              notifyStop:false, message:'Hệ đang lấy {power} từ lưới (PV {pv}, pin {soc}). Lúc {time}.' },
      rules:[]
    };
    const runtime={};
    const rid=()=>Math.random().toString(36).slice(2,9);

    /* ---------- data từ hass ---------- */
    const S=()=> (self._hass && self._hass.states) || {};
    const numOf=(e)=>{ const s=S()[e]; if(!s) return null; const v=parseFloat(s.state); return isNaN(v)?null:v; };
    const fmtName=(e)=>{ const s=S()[e]; return (s&&s.attributes&&s.attributes.friendly_name)||e; };
    const notifyServices=()=>{ const svc=(self._hass&&self._hass.services&&self._hass.services.notify)||{};
      const list=['persistent_notification.create']; Object.keys(svc).forEach(k=>list.push('notify.'+k)); return list; };
    const callService=(domain,service,data)=>{ try{ self._hass.callService(domain,service,data); }catch(e){} };
    const sendNotify=(service,title,message)=>{ const i=service.indexOf('.'); const dom=service.slice(0,i), svc=service.slice(i+1);
      callService(dom,svc,{title,message}); };

    function readings(){
      const gridRaw=numOf(state.map.grid);
      let gridImport=null;
      if(gridRaw!=null) gridImport = state.map.gridSign==='import_pos' ? gridRaw : -gridRaw;
      return { gridRaw, gridImport, soc:numOf(state.map.soc), pv:numOf(state.map.pv), load:numOf(state.map.load), batt:numOf(state.map.batt) };
    }
    function fmtW(w){ if(w==null) return '– W'; const a=Math.abs(w);
      if(a>=1000) return (w/1000).toFixed(2).replace(/\.?0+$/,'')+' kW'; return Math.round(w)+' W'; }

    /* ---------- persistence (HA Store) ---------- */
    async function loadCfg(){
      try{
        const d=await self._hass.connection.sendMessagePromise({type:'inverter_bridge/get'});
        if(d&&d.map) state.map=Object.assign(state.map,d.map);
        if(d&&d.notif) state.notif=Object.assign(state.notif,d.notif);
        if(d&&Array.isArray(d.rules)) state.rules=d.rules;
      }catch(e){}
    }
    // Tự dò cảm biến biến tần theo hậu tố entity_id (không phụ thuộc prefix ib_/inverter_bridge_).
    const AUTO_PAT={ grid:/(^|_)grid_power$/, soc:/(^|_)battery_soc$/, batt:/(^|_)battery_power$/,
                     pv:/(^|_)pv_power$/, load:/(house_load|_load)_power$/ };
    function autoFind(role){
      const pat=AUTO_PAT[role]; if(!pat) return '';
      const cands=Object.keys(S()).filter(e=>e.startsWith('sensor.')&&pat.test(e));
      // ưu tiên entity của thiết bị này (chứa 'ib_' hoặc 'inverter')
      cands.sort((a,b)=>(/ib_|inverter/.test(b)?1:0)-(/ib_|inverter/.test(a)?1:0));
      return cands[0]||'';
    }
    // Tự động điền/lành lại ánh xạ: role nào chưa có entity hợp lệ thì tự dò.
    function reconcileMap(){
      let changed=false;
      ['grid','soc','batt','pv','load'].forEach(role=>{
        const cur=state.map[role];
        if(!cur || !S()[cur]){ const f=autoFind(role); if(f&&f!==cur){ state.map[role]=f; changed=true; } }
      });
      if(changed) saveCfg();
    }
    async function saveCfg(){
      try{ await self._hass.connection.sendMessagePromise({type:'inverter_bridge/save', config:{map:state.map,notif:state.notif,rules:state.rules}}); }
      catch(e){}
    }

    /* ---------- hero ---------- */
    function setNode(id,on,valId,val){ g(id).classList.toggle('on',on); g(valId).textContent=val; }
    function edge(id,active,color,dir,mag){ const el=g(id); el.classList.toggle('active',!!active);
      if(active){ el.style.stroke=color; el.style.animationDirection=dir;
        const speed=Math.max(.5,Math.min(1.6,1.4-Math.min(Math.abs(mag||0),3000)/3000)); el.style.animationDuration=speed.toFixed(2)+'s';
      } else el.style.stroke=''; }
    function renderHero(){
      const r=readings();
      const pvOn=r.pv!=null&&r.pv>20;
      setNode('nodePv',pvOn,'vPv',fmtW(r.pv));
      setNode('nodeLoad',r.load!=null&&r.load>20,'vLoad',fmtW(r.load));
      const battEl=g('nodeBatt'), soc=r.soc;
      g('vBatt').textContent = soc!=null?Math.round(soc)+' %':'– %';
      let bs='–'; if(r.batt!=null){ if(r.batt>15)bs='Đang sạc'; else if(r.batt<-15)bs='Đang xả'; else bs='Nghỉ'; }
      g('vBattSub').textContent = r.batt!=null?bs+' · '+fmtW(Math.abs(r.batt)):'';
      battEl.classList.toggle('on',soc!=null);
      battEl.style.setProperty('--nc', soc!=null&&soc<25?'var(--grid-in)':'var(--batt)');
      const gi=r.gridImport, gEl=g('nodeGrid');
      g('vGrid').textContent = gi!=null?fmtW(Math.abs(gi)):'– W';
      const importing=gi!=null&&gi>(state.notif.threshold||0), exporting=gi!=null&&gi<-20;
      g('vGridSub').textContent = importing?'Đang nhập':(exporting?'Đang bán':(gi!=null?'Cân bằng':''));
      gEl.classList.toggle('on', gi!=null&&(importing||exporting));
      gEl.style.setProperty('--nc', importing?'var(--grid-in)':(exporting?'var(--grid-out)':'var(--grid-in)'));
      edge('e-pv',pvOn,'var(--solar)','normal',r.pv);
      edge('e-load',r.load!=null&&r.load>20,'var(--load)','normal',r.load);
      if(r.batt!=null&&Math.abs(r.batt)>15) edge('e-batt',true,'var(--batt)',r.batt>0?'normal':'reverse',r.batt); else edge('e-batt',false);
      if(importing) edge('e-grid',true,'var(--grid-in)','reverse',gi);
      else if(exporting) edge('e-grid',true,'var(--grid-out)','normal',gi); else edge('e-grid',false);
      const badge=g('gridBadge'), txt=g('gridBadgeTxt'); badge.className='grid-badge';
      if(gi==null) txt.textContent='Chưa có dữ liệu lưới';
      else if(importing){ badge.classList.add('importing'); txt.innerHTML='ĐANG LẤY LƯỚI · <b>'+fmtW(gi)+'</b>'; }
      else if(exporting){ badge.classList.add('exporting'); txt.innerHTML='ĐANG BÁN LƯỚI · <b>'+fmtW(-gi)+'</b>'; }
      else { badge.classList.add('self'); txt.textContent='KHÔNG LẤY LƯỚI · tự cấp'; }
      g('refreshed').textContent='cập nhật '+new Date().toLocaleTimeString('vi-VN');
      const chip=g('notifLiveChip'), ctxt=g('notifLiveTxt'); chip.className='live-chip';
      if(gi==null) ctxt.textContent='Chưa ánh xạ cảm biến lưới';
      else if(importing){ chip.classList.add('hot'); ctxt.textContent='Hiện tại: đang lấy '+fmtW(gi)+' từ lưới'; }
      else { chip.classList.add('cool'); ctxt.textContent='Hiện tại: không lấy lưới (tự cấp)'; }
    }

    /* ---------- notif panel ---------- */
    function renderNotif(){
      g('notifToggle').classList.toggle('on',state.notif.enabled);
      g('notifBody').classList.toggle('collapsed',!state.notif.enabled);
      g('nfThreshold').value=state.notif.threshold;
      g('nfFor').value=String(state.notif.forSec);
      g('nfCooldown').value=String(state.notif.cooldownSec);
      g('nfStopToggle').classList.toggle('on',state.notif.notifyStop);
      g('nfMessage').value=state.notif.message;
      fillNotifyServices(); renderPreview();
    }
    function fillNotifyServices(){
      const sel=g('nfService'), list=notifyServices(); sel.innerHTML='';
      list.forEach(s=>{ const o=document.createElement('option'); o.value=s; o.textContent=s; if(s===state.notif.service)o.selected=true; sel.appendChild(o); });
      if(!list.includes(state.notif.service)){ const o=document.createElement('option'); o.value=state.notif.service; o.textContent=state.notif.service; o.selected=true; sel.appendChild(o); }
    }
    function renderMessage(tpl){ const r=readings();
      return tpl.replace(/\{power\}/g,r.gridImport!=null?fmtW(Math.max(0,r.gridImport)):'– W')
        .replace(/\{pv\}/g,fmtW(r.pv)).replace(/\{soc\}/g,r.soc!=null?Math.round(r.soc)+'%':'–')
        .replace(/\{load\}/g,fmtW(r.load)).replace(/\{time\}/g,new Date().toLocaleTimeString('vi-VN')); }
    function renderMessagePlain(tpl){ const r=readings();
      return tpl.replace(/\{power\}/g,r.gridImport!=null?Math.round(Math.max(0,r.gridImport))+' W':'–')
        .replace(/\{pv\}/g,r.pv!=null?Math.round(r.pv)+' W':'–').replace(/\{soc\}/g,r.soc!=null?Math.round(r.soc)+'%':'–')
        .replace(/\{load\}/g,r.load!=null?Math.round(r.load)+' W':'–').replace(/\{time\}/g,new Date().toLocaleTimeString('vi-VN')); }
    function renderPreview(){ g('pvMsg').textContent=renderMessage(g('nfMessage').value);
      g('pvTag').textContent='→ '+state.notif.service+'  ·  '+fmtName(state.map.grid); }

    /* ---------- rules ---------- */
    function fmtDur(s){ if(s>=3600)return (s/3600)+' giờ'; if(s>=60)return (s/60)+' phút'; return s+'s'; }
    function renderRules(){
      const wrap=g('rulesList'); wrap.innerHTML='';
      const on=state.rules.filter(r=>r.enabled).length;
      g('rulesMeta').textContent=state.rules.length+' quy tắc · '+on+' đang bật';
      if(state.rules.length===0){
        wrap.innerHTML='<div class="empty"><h3>Chưa có quy tắc nào</h3><p>Tạo quy tắc để tự động tắt/bật thiết bị theo trạng thái hệ điện.</p><button class="btn primary" id="emptyAdd">'+icon('plus')+' Thêm quy tắc</button></div>';
        wrap.querySelector('#emptyAdd').onclick=()=>openRuleModal(null); return;
      }
      state.rules.forEach(rule=>{
        const t=TRIGGERS[rule.trig.type], card=document.createElement('div');
        card.className='rule'+(rule.enabled?' enabled':'')+(runtime[rule.id]&&runtime[rule.id].armed?' armed':'');
        const forTxt=rule.trig.forSec>0?' (giữ '+fmtDur(rule.trig.forSec)+')':'';
        const thTxt=rule.trig.type==='grid_import_start'?'':' <b>'+rule.trig.threshold+' '+t.unit+'</b>';
        const devs=rule.entities.map(e=>'<span>'+esc(fmtName(e))+'</span>').join('');
        card.innerHTML='<div class="rule-top"><div class="rule-name">'+esc(rule.name)+'</div>'+
          '<div class="rule-actions"><button class="rk" data-act="edit" title="Sửa">'+icon('pencil')+'</button>'+
          '<button class="rk danger" data-act="del" title="Xóa">'+icon('trash')+'</button></div>'+
          '<div class="switch'+(rule.enabled?' on':'')+'" data-act="toggle" style="margin-left:4px"><div class="knob"></div></div></div>'+
          '<div class="rule-when"><span class="rule-tag when">KHI</span><div class="rule-body"><b>'+esc(t.label)+'</b>'+thTxt+forTxt+'</div></div>'+
          '<div class="rule-then"><span class="rule-tag then">THÌ</span><div class="rule-body"><b>'+(rule.action==='turn_off'?'Tắt':'Bật')+'</b> '+rule.entities.length+' thiết bị<div class="chiplist">'+devs+'</div></div></div>';
        card.querySelector('[data-act=edit]').onclick=()=>openRuleModal(rule);
        card.querySelector('[data-act=del]').onclick=()=>{ state.rules=state.rules.filter(x=>x.id!==rule.id); delete runtime[rule.id]; saveCfg(); renderRules(); };
        card.querySelector('[data-act=toggle]').onclick=()=>{ rule.enabled=!rule.enabled; delete runtime[rule.id]; saveCfg(); renderRules(); };
        wrap.appendChild(card);
      });
    }

    /* ---------- rule editor ---------- */
    let ruCtx={ rule:null, trig:'grid_import_start', action:'turn_off', entities:new Set(), forSec:30, coolSec:300 };
    function openRuleModal(rule){
      ruCtx.rule=rule;
      g('ruleModalTitle').textContent=rule?'Sửa quy tắc':'Thêm quy tắc';
      g('ruDelBtn').style.display=rule?'block':'none';
      ruCtx.trig=rule?rule.trig.type:'grid_import_start';
      ruCtx.action=rule?rule.action:'turn_off';
      ruCtx.entities=new Set(rule?rule.entities:[]);
      ruCtx.forSec=rule?rule.trig.forSec:30;
      ruCtx.coolSec=rule?rule.cooldownSec:300;
      g('ruName').value=rule?rule.name:'';
      g('ruThresh').value=rule?rule.trig.threshold:TRIGGERS[ruCtx.trig].def;
      buildTrigPick(); applyTrig(); buildActPick(); buildDevList();
      setSeg('ruForSeg',ruCtx.forSec); setSeg('ruCoolSeg',ruCtx.coolSec);
      showModal('ruleModal'); setTimeout(()=>g('ruName').focus(),50);
    }
    function buildTrigPick(){ const el=g('trigPick'); el.innerHTML='';
      Object.keys(TRIGGERS).forEach(k=>{ const t=TRIGGERS[k], o=document.createElement('div');
        o.className='opt'+(k===ruCtx.trig?' sel':'');
        o.innerHTML=triIcon(k)+'<div><div class="ot">'+t.label+'</div><div class="od">'+t.desc+'</div></div>';
        o.onclick=()=>{ ruCtx.trig=k; g('ruThresh').value=TRIGGERS[k].def; buildTrigPick(); applyTrig(); }; el.appendChild(o); });
    }
    function applyTrig(){ const t=TRIGGERS[ruCtx.trig];
      g('threshLabel').textContent=t.tlabel; g('threshUnit').textContent=t.unit; g('threshHint').textContent=t.thint; g('threshField').style.display='block'; }
    function buildActPick(){ qsa('#actPick .opt').forEach(o=>{ o.classList.toggle('sel',o.dataset.a===ruCtx.action);
      o.querySelector('span').innerHTML=o.dataset.a==='turn_off'?icon('power'):icon('bolt'); o.onclick=()=>{ ruCtx.action=o.dataset.a; buildActPick(); }; }); }
    function buildDevList(){ const list=g('ruDevList'); list.innerHTML='';
      const doms=['switch','light','input_boolean','fan','climate'];
      const ents=Object.keys(S()).filter(e=>doms.includes(e.split('.')[0])).sort();
      if(ents.length===0) list.innerHTML='<div style="color:var(--faint);font-size:13px;padding:8px">Chưa thấy thiết bị điều khiển được (công tắc/đèn/quạt/điều hòa).</div>';
      ents.forEach(e=>{ const o=document.createElement('div'); o.className='dev-opt'+(ruCtx.entities.has(e)?' on':'');
        o.innerHTML='<div class="dev-check">'+icon('check')+'</div><div style="min-width:0"><div class="dn">'+esc(fmtName(e))+'</div><div class="de">'+e+'</div></div>';
        o.onclick=()=>{ if(ruCtx.entities.has(e))ruCtx.entities.delete(e); else ruCtx.entities.add(e); o.classList.toggle('on'); updDevCount(); }; list.appendChild(o); });
      updDevCount();
    }
    function updDevCount(){ g('devCount').textContent=ruCtx.entities.size; }
    function setSeg(id,val){ qsa('#'+id+' button').forEach(b=>b.classList.toggle('active',b.dataset.v===String(val))); }
    qsa('#ruForSeg button').forEach(b=>b.onclick=()=>{ ruCtx.forSec=parseInt(b.dataset.v); setSeg('ruForSeg',ruCtx.forSec); });
    qsa('#ruCoolSeg button').forEach(b=>b.onclick=()=>{ ruCtx.coolSec=parseInt(b.dataset.v); setSeg('ruCoolSeg',ruCtx.coolSec); });
    g('ruSaveBtn').onclick=()=>{
      const name=g('ruName').value.trim()||TRIGGERS[ruCtx.trig].label;
      const thresh=parseFloat(g('ruThresh').value)||TRIGGERS[ruCtx.trig].def;
      const data={ name, enabled:true, action:ruCtx.action, entities:[...ruCtx.entities], cooldownSec:ruCtx.coolSec, trig:{ type:ruCtx.trig, threshold:thresh, forSec:ruCtx.forSec } };
      if(ruCtx.rule) Object.assign(ruCtx.rule,data); else { data.id=rid(); state.rules.push(data); }
      saveCfg(); renderRules(); closeModal('ruleModal');
    };
    g('ruDelBtn').onclick=()=>{ if(!ruCtx.rule)return; state.rules=state.rules.filter(x=>x.id!==ruCtx.rule.id); delete runtime[ruCtx.rule.id]; saveCfg(); renderRules(); closeModal('ruleModal'); };

    /* ---------- engine (chạy khi panel mở) ---------- */
    function evalCond(type,threshold,r){
      switch(type){
        case 'grid_import_start': case 'grid_import_above': return { on:r.gridImport!=null&&r.gridImport>threshold, val:r.gridImport };
        case 'battery_below': return { on:r.soc!=null&&r.soc<threshold, val:r.soc };
        case 'pv_below': return { on:r.pv!=null&&r.pv<threshold, val:r.pv };
        case 'load_above': return { on:r.load!=null&&r.load>threshold, val:r.load };
      } return { on:false };
    }
    function handleTrigger(key,cfg,r,now,onFire,onReset){
      let rt=runtime[key]; if(!rt){ rt=runtime[key]={since:0,fired:false,lastFired:0,armed:false}; }
      const c=evalCond(cfg.type,cfg.threshold,r); rt.armed=c.on&&!rt.fired;
      if(c.on){ if(!rt.since)rt.since=now;
        const held=(now-rt.since)>=(cfg.forSec*1000), coolOk=(now-rt.lastFired)>=(cfg.cooldownSec*1000);
        if(held&&!rt.fired&&coolOk){ rt.fired=true; rt.lastFired=now; onFire&&onFire(); }
        else if(held&&!rt.fired&&!coolOk){ rt.fired=true; }
      } else { if(rt.fired&&onReset)onReset(); rt.since=0; rt.fired=false; rt.armed=false; }
    }
    function engineTick(){
      const r=readings(), now=Date.now();
      if(state.notif.enabled){
        handleTrigger('notif',{type:'grid_import_start',threshold:state.notif.threshold,forSec:state.notif.forSec,cooldownSec:state.notif.cooldownSec},r,now,
          ()=>{ toast('alert','bell','Bắt đầu lấy điện lưới',renderMessage(state.notif.message)); sendNotify(state.notif.service,'Cảnh báo điện lưới',renderMessagePlain(state.notif.message)); },
          ()=>{ if(state.notif.notifyStop){ toast('ok','check','Đã ngừng lấy lưới','Hệ đã tự cấp trở lại lúc '+new Date().toLocaleTimeString('vi-VN')); sendNotify(state.notif.service,'Điện lưới','Hệ đã tự cấp trở lại.'); } });
      } else delete runtime['notif'];
      state.rules.forEach(rule=>{
        if(!rule.enabled){ delete runtime[rule.id]; return; }
        handleTrigger(rule.id,{type:rule.trig.type,threshold:rule.trig.threshold,forSec:rule.trig.forSec,cooldownSec:rule.cooldownSec},r,now,
          ()=>{ if(rule.entities.length){ callService('homeassistant',rule.action,{entity_id:rule.entities});
            const names=rule.entities.map(fmtName).join(', ');
            toast('action',rule.action==='turn_off'?'power':'bolt',(rule.action==='turn_off'?'Đã tắt ':'Đã bật ')+rule.entities.length+' thiết bị','“'+rule.name+'” · '+names); } },null);
      });
      if(!isModalOpen()) renderRules();
    }

    /* ---------- YAML ---------- */
    function gridTrigYaml(threshold,forSec,indent){ const p=' '.repeat(indent);
      const dir=state.map.gridSign==='import_pos'?('above: '+threshold):('below: -'+threshold);
      let y=p+'- platform: numeric_state\n'+p+'    entity_id: '+state.map.grid+'\n'+p+'    '+dir+'\n';
      if(forSec>0) y+=p+'    for:\n'+p+'      seconds: '+forSec+'\n'; return y; }
    function trigYaml(trig,indent){ const p=' '.repeat(indent), th=trig.threshold, forSec=trig.forSec;
      if(trig.type==='grid_import_start'||trig.type==='grid_import_above') return gridTrigYaml(th,forSec,indent);
      let ent,cmp;
      if(trig.type==='battery_below'){ ent=state.map.soc; cmp='below: '+th; }
      else if(trig.type==='pv_below'){ ent=state.map.pv; cmp='below: '+th; }
      else { ent=state.map.load; cmp='above: '+th; }
      let y=p+'- platform: numeric_state\n'+p+'    entity_id: '+(ent||'sensor.CHUA_ANH_XA')+'\n'+p+'    '+cmp+'\n';
      if(forSec>0) y+=p+'    for:\n'+p+'      seconds: '+forSec+'\n'; return y; }
    function notifYaml(){ const n=state.notif;
      const msg=n.message.replace(/\{power\}/g,'{{ (states("'+state.map.grid+'")|float(0))|abs|round(0) }} W')
        .replace(/\{soc\}/g,'{{ states("'+state.map.soc+'") }}%')
        .replace(/\{pv\}/g,state.map.pv?('{{ states("'+state.map.pv+'") }} W'):'–')
        .replace(/\{load\}/g,state.map.load?('{{ states("'+state.map.load+'") }} W'):'–')
        .replace(/\{time\}/g,'{{ now().strftime("%H:%M") }}');
      let y='# === Thông báo khi bắt đầu lấy điện lưới ===\n- alias: "Báo khi bắt đầu lấy điện lưới"\n  trigger:\n'+gridTrigYaml(n.threshold,n.forSec,4);
      y+='  action:\n    - service: '+n.service+'\n      data:\n        title: "Cảnh báo điện lưới"\n        message: "'+msg.replace(/"/g,'\\"')+'"\n  mode: single\n';
      if(n.notifyStop){ const dir=state.map.gridSign==='import_pos'?('below: '+n.threshold):('above: -'+n.threshold);
        y+='\n- alias: "Báo khi ngừng lấy điện lưới"\n  trigger:\n    - platform: numeric_state\n      entity_id: '+state.map.grid+'\n      '+dir+'\n      for:\n        seconds: '+Math.max(30,n.forSec)+'\n';
        y+='  action:\n    - service: '+n.service+'\n      data:\n        title: "Điện lưới"\n        message: "Hệ đã tự cấp trở lại."\n  mode: single\n'; }
      return y; }
    function ruleYaml(rule){ let y='# === '+rule.name+' ===\n- alias: "'+rule.name.replace(/"/g,'\\"')+'"\n  trigger:\n'+trigYaml(rule.trig,4);
      y+='  action:\n    - service: homeassistant.'+rule.action+'\n      target:\n        entity_id:\n';
      rule.entities.forEach(e=>y+='          - '+e+'\n'); y+='  mode: single\n'; return y; }
    function openYaml(kind){ let out='';
      if(kind==='notif') out=notifYaml();
      else { out=state.rules.filter(r=>r.enabled).map(ruleYaml).join('\n'); if(!out)out='# Chưa có quy tắc nào đang bật'; }
      g('yamlTitle').textContent=kind==='notif'?'YAML · Thông báo lấy lưới':'YAML · Quy tắc tự động';
      g('yamlOut').textContent=out; g('copyYamlBtn').innerHTML=icon('copy')+' Sao chép'; showModal('yamlModal'); }
    g('copyYamlBtn').onclick=()=>{ const txt=g('yamlOut').textContent; const done=()=>{ g('copyYamlBtn').innerHTML=icon('check')+' Đã sao chép'; };
      if(navigator.clipboard) navigator.clipboard.writeText(txt).then(done).catch(()=>fallbackCopy(txt,done)); else fallbackCopy(txt,done); };
    function fallbackCopy(txt,cb){ const ta=document.createElement('textarea'); ta.value=txt; document.body.appendChild(ta); ta.select(); try{document.execCommand('copy');}catch(e){} ta.remove(); cb&&cb(); }

    /* ---------- toasts ---------- */
    function toast(kind,ic,title,msg){ const wrap=g('toasts'), el=document.createElement('div'); el.className='toast '+kind;
      el.innerHTML='<div class="t-ic">'+icon(ic)+'</div><div style="min-width:0"><div class="t-t">'+esc(title)+'</div><div class="t-m">'+esc(msg)+'</div></div>';
      wrap.appendChild(el); setTimeout(()=>{ el.classList.add('out'); setTimeout(()=>el.remove(),300); },6000); }

    /* ---------- mapping modal ---------- */
    function openMapModal(){ fillMapSelects(); setSeg('signSeg',state.map.gridSign); showModal('mapModal'); }
    function fillMapSelects(){
      const sensors=Object.keys(S()).filter(e=>e.startsWith('sensor.')).sort();
      [['mapGrid','grid'],['mapSoc','soc'],['mapBatt','batt'],['mapPv','pv'],['mapLoad','load']].forEach(([id,key])=>{
        const sel=g(id), optional=(key!=='grid'&&key!=='soc');
        sel.innerHTML=optional?'<option value="">— Không dùng —</option>':'';
        sensors.forEach(e=>{ const o=document.createElement('option'); o.value=e; o.textContent=fmtName(e)+'  ('+e+')'; if(e===state.map[key])o.selected=true; sel.appendChild(o); });
        if(sensors.length===0&&!optional) sel.innerHTML='<option value="">— Chưa có sensor —</option>';
      });
      updateMapLive();
    }
    function updateMapLive(){ const gv=g('mapGrid').value, v=numOf(gv);
      g('mapGridLive').innerHTML=v!=null?'Giá trị hiện tại: <b>'+(v>0?'+':'')+Math.round(v)+'</b> (theo cảm biến gốc)':''; }
    g('mapGrid').onchange=()=>updateMapLive();
    qsa('#signSeg button').forEach(b=>b.onclick=()=>{ state.map.gridSign=b.dataset.v; setSeg('signSeg',b.dataset.v); renderHero(); });
    g('mapSaveBtn').onclick=()=>{
      state.map.grid=g('mapGrid').value; state.map.soc=g('mapSoc').value; state.map.batt=g('mapBatt').value;
      state.map.pv=g('mapPv').value; state.map.load=g('mapLoad').value;
      saveCfg(); renderHero(); renderPreview(); closeModal('mapModal');
    };

    /* ---------- modal helpers ---------- */
    function showModal(id){ g(id).classList.add('show'); }
    function closeModal(id){ g(id).classList.remove('show'); }
    function isModalOpen(){ return !!root.querySelector('.scrim.show'); }
    qsa('[data-close]').forEach(b=>b.onclick=()=>b.closest('.scrim').classList.remove('show'));
    qsa('.scrim').forEach(s=>s.addEventListener('click',e=>{ if(e.target===s)s.classList.remove('show'); }));

    /* ---------- bindings ---------- */
    g('menuBtn').onclick=()=>self.dispatchEvent(new CustomEvent('hass-toggle-menu',{bubbles:true,composed:true}));
    g('settingsBtn').onclick=openMapModal;
    g('notifToggle').onclick=()=>{ state.notif.enabled=!state.notif.enabled; delete runtime['notif']; saveCfg(); renderNotif(); };
    g('nfStopToggle').onclick=()=>{ state.notif.notifyStop=!state.notif.notifyStop; saveCfg(); g('nfStopToggle').classList.toggle('on',state.notif.notifyStop); };
    g('nfThreshold').oninput=e=>{ state.notif.threshold=parseFloat(e.target.value)||0; saveCfg(); };
    g('nfFor').onchange=e=>{ state.notif.forSec=parseInt(e.target.value); delete runtime['notif']; saveCfg(); };
    g('nfCooldown').onchange=e=>{ state.notif.cooldownSec=parseInt(e.target.value); saveCfg(); };
    g('nfService').onchange=e=>{ state.notif.service=e.target.value; saveCfg(); renderPreview(); };
    g('nfMessage').oninput=e=>{ state.notif.message=e.target.value; saveCfg(); renderPreview(); };
    g('nfTestBtn').onclick=()=>{ toast('alert','bell','Thử thông báo',renderMessage(state.notif.message)); sendNotify(state.notif.service,'Cảnh báo điện lưới (thử)',renderMessagePlain(state.notif.message)); };
    g('nfYamlBtn').onclick=()=>openYaml('notif');
    g('rulesYamlBtn').onclick=()=>openYaml('rules');
    g('addRuleBtn').onclick=()=>openRuleModal(null);
    qsa('#seg button').forEach(b=>b.onclick=()=>{ qsa('#seg button').forEach(x=>x.classList.remove('active')); b.classList.add('active');
      qsa('.panel-view').forEach(p=>p.classList.remove('show')); g('panel-'+b.dataset.p).classList.add('show'); });

    // placeholder chips
    (function(){ const el=g('phList'); el.innerHTML='';
      ['{power}','{pv}','{soc}','{load}','{time}'].forEach(p=>{ const c=document.createElement('code'); c.textContent=p;
        c.onclick=()=>{ const ta=g('nfMessage'); ta.value+=(ta.value.endsWith(' ')||!ta.value?'':' ')+p; state.notif.message=ta.value; saveCfg(); renderPreview(); }; el.appendChild(c); }); })();

    // icons + labels tĩnh
    (function(){
      root.querySelector('#nodePv .disc').innerHTML=triIcon('pv_below');
      root.querySelector('#nodeGrid .disc').innerHTML=triIcon('grid_import_start');
      root.querySelector('#nodeBatt .disc').innerHTML=triIcon('battery_below');
      root.querySelector('#nodeLoad .disc').innerHTML=triIcon('load_above');
      g('hubCore').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2.5 5.5 13h5l-1.5 8.5L18.5 11h-5z"/></svg>';
      g('notifHeadIc').innerHTML=icon('bell');
      root.querySelector('.notif-preview .np-ic').innerHTML=icon('bell');
      qsa('.hint-box .hb-ic').forEach(e=>e.innerHTML=icon('info'));
      const sb=qsa('#seg button'); sb[0].innerHTML=icon('bell')+' Thông báo'; sb[1].innerHTML=icon('bolt')+' Tự động hóa';
      g('nfTestBtn').innerHTML=icon('bell')+' Thử thông báo';
      g('nfYamlBtn').innerHTML=icon('code')+' Xuất YAML';
      g('rulesYamlBtn').innerHTML=icon('code')+' Xuất YAML';
      g('addRuleBtn').innerHTML=icon('plus')+' Thêm quy tắc';
    })();

    // Cập nhật theo sự kiện hass (tiết lưu ~1.5s để không chạy engine quá dày,
    // vì set hass được gọi mỗi khi BẤT KỲ entity nào trong HA đổi trạng thái).
    this._onHass=()=>{
      const now=Date.now();
      if(now-(this._lastTick||0) < 1500) return;
      this._lastTick=now;
      if(isModalOpen()) return;
      if(!S()[state.map.grid]) reconcileMap();   // thiết bị lên trễ -> tự dò lại
      engineTick(); renderHero();
    };

    // init: nạp cấu hình -> tự dò cảm biến -> render lần đầu
    (async()=>{
      await loadCfg();
      reconcileMap();   // tự động điền ánh xạ, không cần thao tác tay
      renderHero(); renderNotif(); renderRules();
      this._ready=true; this._booting=false;
    })();
  }
}

if(!customElements.get('solar-inverter-panel')){
  customElements.define('solar-inverter-panel', SolarInverterPanel);
}
console.info('%c HỆ ĐIỆN MẶT TRỜI %c panel v1 ',
  'background:#f0676a;color:#fff;border-radius:4px 0 0 4px;padding:2px 6px',
  'background:#7d3436;color:#fff;border-radius:0 4px 4px 0;padding:2px 6px');
