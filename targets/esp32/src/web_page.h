/* Clockling - settings page served at http://clockling.local/.
 * Everything (keys, defaults, groups, Visible/Advanced) comes from /api/config,
 * which the firmware builds from the generated tuning table. */
#pragma once
#include <pgmspace.h>

static const char WEB_PAGE[] PROGMEM = R"HTML(<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Clockling settings</title>
<style>
:root{--bg:#0b0618;--panel:#160d33;--line:#2a1f55;--text:#eafff0;--dim:#a99fd0;--accent:#b6ff5e;--purple:#c39bff;--warn:#ff6b4a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{position:sticky;top:0;z-index:2;background:rgba(11,6,24,.94);backdrop-filter:blur(6px);border-bottom:1px solid var(--line);padding:12px 16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
h1{font-size:18px;margin:0;color:var(--accent);flex:1}
main{max-width:720px;margin:0 auto;padding:8px 16px 96px}
section{background:var(--panel);border:1px solid var(--line);border-radius:10px;margin:14px 0;overflow:hidden}
section h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--purple);margin:0;padding:10px 14px;border-bottom:1px solid var(--line)}
.row{display:flex;align-items:center;gap:10px;padding:9px 14px;border-top:1px solid rgba(42,31,85,.5)}
.row:first-of-type{border-top:0}
.row.adv{display:none}
body.showadv .row.adv{display:flex}
.lbl{flex:1;min-width:0}
.k{font-weight:600;word-break:break-word}
.m{color:var(--dim);font-size:13px}
.tag{font-size:10px;color:var(--dim);border:1px solid var(--line);border-radius:4px;padding:0 4px;margin-left:6px;vertical-align:middle}
input[type=number],input[type=text]{width:96px;background:#0b0618;color:var(--text);border:1px solid var(--line);border-radius:6px;padding:6px 8px;font:inherit}
input[type=text]{width:100%}
input[type=checkbox]{width:22px;height:22px;accent-color:var(--accent)}
.changed .k{color:var(--accent)}
.rev{background:none;border:1px solid var(--line);color:var(--dim);border-radius:6px;width:30px;height:30px;cursor:pointer;visibility:hidden}
.changed .rev{visibility:visible}
button.b{background:var(--line);color:var(--text);border:0;border-radius:8px;padding:9px 14px;font:inherit;cursor:pointer}
button.p{background:var(--accent);color:#0b0618;font-weight:700}
button.w{color:var(--warn)}
footer{position:fixed;left:0;right:0;bottom:0;background:rgba(11,6,24,.96);border-top:1px solid var(--line);padding:10px 16px;display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
#msg{color:var(--accent);font-size:13px;min-height:1em}
label.t{display:flex;align-items:center;gap:6px;color:var(--dim);font-size:13px}
.tz{padding:10px 14px}
</style></head><body>
<header><h1>Clockling</h1><span id="msg"></span>
<label class="t"><input type="checkbox" id="adv"> Advanced</label></header>
<main id="main"><p class="m">Loading&hellip;</p></main>
<footer>
<button class="b p" id="save">Save</button>
<button class="b" id="restart">Restart battle</button>
<button class="b" id="resetall">Reset all</button>
<button class="b w" id="wifi">Forget WiFi</button>
</footer>
<script>
"use strict";
var cfg=null, inputs={};
function $(id){return document.getElementById(id)}
function msg(t){$("msg").textContent=t;clearTimeout(msg.t);msg.t=setTimeout(function(){$("msg").textContent=""},3000)}
function fmt(v){return Math.round(v*10000)/10000}
function val(e){var i=inputs[e.k];return e.b?(i.checked?1:0):parseFloat(i.value)}
function mark(e){var r=inputs[e.k].closest(".row"),v=val(e);r.classList.toggle("changed",!isNaN(v)&&fmt(v)!==fmt(e.d))}
function build(){
  var main=$("main");main.innerHTML="";
  var tz=document.createElement("section");
  tz.innerHTML='<h2>Time zone</h2><div class="tz"><input type="text" id="tz" list="tzl" spellcheck="false">'+
  '<datalist id="tzl"><option value="GMT0BST,M3.5.0/1,M10.5.0">UK</option><option value="CET-1CEST,M3.5.0,M10.5.0/3">Central Europe</option>'+
  '<option value="EST5EDT,M3.2.0,M11.1.0">US Eastern</option><option value="PST8PDT,M3.2.0,M11.1.0">US Pacific</option>'+
  '<option value="AEST-10AEDT,M10.1.0,M4.1.0/3">Sydney</option><option value="UTC0">UTC</option></datalist>'+
  '<div class="m">POSIX TZ string (pick a preset or paste your own).</div></div>';
  main.appendChild(tz);$("tz").value=cfg.tz;
  cfg.groups.forEach(function(g,gi){
    var keys=cfg.keys.filter(function(e){return e.g===gi});
    if(!keys.length)return;
    keys.sort(function(a,b){return a.a-b.a});
    var s=document.createElement("section"),h=document.createElement("h2");
    h.textContent=g;s.appendChild(h);
    if(keys.every(function(e){return e.a}))s.className="advsec";
    keys.forEach(function(e){
      var r=document.createElement("div");r.className="row"+(e.a?" adv":"");
      var l=document.createElement("div");l.className="lbl";
      l.innerHTML='<div class="k"></div><div class="m"></div>';
      l.firstChild.textContent=e.k;if(e.a){var t=document.createElement("span");t.className="tag";t.textContent="adv";l.firstChild.appendChild(t)}
      l.lastChild.textContent=e.m+(e.b?"":" (default "+fmt(e.d)+")");
      var i=document.createElement("input");
      if(e.b){i.type="checkbox";i.checked=!!e.v}else{i.type="number";i.step="any";i.value=fmt(e.v)}
      i.addEventListener("input",function(){mark(e)});
      var rv=document.createElement("button");rv.className="rev";rv.title="Revert to default";rv.textContent="↺";
      rv.onclick=function(){if(e.b)i.checked=!!e.d;else i.value=fmt(e.d);mark(e)};
      r.appendChild(l);r.appendChild(i);r.appendChild(rv);s.appendChild(r);
      inputs[e.k]=i;
    });
    main.appendChild(s);
    cfg.keys.forEach(function(e){if(e.g===gi)mark(e)});
  });
  syncAdv();
}
function syncAdv(){
  document.body.classList.toggle("showadv",$("adv").checked);
  document.querySelectorAll("section.advsec").forEach(function(s){s.style.display=$("adv").checked?"":"none"});
}
function load(){fetch("/api/config").then(function(r){return r.json()}).then(function(j){cfg=j;build()}).catch(function(){msg("Could not reach the clock")})}
function post(url,body){return fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:body?JSON.stringify(body):"{}"})}
$("save").onclick=function(){
  var values={};
  cfg.keys.forEach(function(e){var v=val(e);if(!isNaN(v))values[e.k]=v});
  post("/api/config",{values:values,tz:$("tz").value.trim()}).then(function(r){msg(r.ok?"Saved":"Save failed");load()});
};
$("restart").onclick=function(){post("/api/restart").then(function(){msg("Battle restarted")})};
$("resetall").onclick=function(){if(confirm("Reset every setting to its default?"))post("/api/reset").then(function(){msg("Defaults restored");load()})};
$("wifi").onclick=function(){if(confirm("Forget WiFi and reboot into setup mode (Clockling-Setup hotspot)?"))post("/api/wifi-reset").then(function(){msg("Rebooting into setup")})};
$("adv").onchange=function(){try{localStorage.setItem("clocklingAdv",$("adv").checked?"1":"0")}catch(e){}syncAdv()};
try{$("adv").checked=localStorage.getItem("clocklingAdv")==="1"}catch(e){}
load();
</script></body></html>)HTML";
