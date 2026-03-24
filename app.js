/**
 * app.js — MSDS AI OCR 분석 포털 (버전 3)
 *
 * 역할:
 *  - 파일 선택 / 드래그앤드롭 / Ctrl+V 붙여넣기
 *  - POST /api/msds/analyze → Flask → GPT-4o OCR → K-REACH · KOSHA
 *  - 결과 테이블 렌더링 (버전1 renderAll 방식 유지)
 */

// ── Railway 배포 URL 로 변경하거나, 로컬 실행 시 http://localhost:5000 사용 ──
const PROXY = 'https://chemicalocr-api.onrender.com';

let selFiles = [];

/* ══════════════════════════════════════════
   서버 상태 확인
══════════════════════════════════════════ */
async function checkServer(){
  const bar = document.getElementById('srvBar');
  const txt = document.getElementById('srvTxt');

  // Render cold start 대기 안내
  txt.textContent = '● 서버 시작 중... (최초 접속 시 최대 60초 소요)';
  txt.style.color = 'var(--orange)';
  bar.className   = 'srv-bar warn';

  try {
    const r = await fetch(PROXY + '/', { signal: AbortSignal.timeout(70000) }); // 70초
    const d = await r.json();
    const ocrOk = d.services?.msds_ocr === '준비됨';
    const krOk  = d.services?.kreach   === '정상';
    const koOk  = d.services?.kosha    === '정상';
    if (ocrOk && krOk && koOk) {
      txt.textContent = '● 서버 연결됨 ✅  OCR + K-REACH + KOSHA 준비 완료';
      txt.style.color = 'var(--green)';
      bar.className   = 'srv-bar';
    } else {
      const warn = [];
      if (!ocrOk) warn.push('GPT OCR 미준비 (OPENAI_KEY 환경변수 확인)');
      if (!krOk)  warn.push('K-REACH 오류');
      if (!koOk)  warn.push('KOSHA 오류');
      txt.textContent = '● 서버 연결됨 ⚠️  ' + warn.join(' / ');
      txt.style.color = 'var(--orange)';
      bar.className   = 'srv-bar warn';
    }
  } catch(err) {
    const isTimeout = err.name === 'TimeoutError' || err.message?.includes('timeout');
    txt.textContent = isTimeout
      ? '● 서버 응답 없음 ❌  — Render 대시보드에서 서비스 상태 확인'
      : '● 서버 연결 실패 ❌  — ' + err.message;
    txt.style.color = 'var(--red)';
    bar.className   = 'srv-bar warn';
  }
}
window.addEventListener('load', checkServer);

/* ══════════════════════════════════════════
   Ctrl+V 이미지 붙여넣기
══════════════════════════════════════════ */
document.addEventListener('paste', (e) => {
  const items    = [...(e.clipboardData?.items || [])];
  const imgItems = items.filter(i => i.type.startsWith('image/'));
  if (!imgItems.length) return;
  e.preventDefault();
  const files = imgItems.map(i => i.getAsFile()).filter(Boolean);
  if (files.length) {
    setFiles(files);
    const dz = document.getElementById('dropZone');
    dz.classList.add('drag');
    setTimeout(() => dz.classList.remove('drag'), 600);
  }
});

/* ══════════════════════════════════════════
   드롭존 이벤트
══════════════════════════════════════════ */
function dz(e, a) {
  e.preventDefault();
  document.getElementById('dropZone').classList[a]('drag');
}

function onDrop(e) {
  e.preventDefault();
  document.getElementById('dropZone').classList.remove('drag');
  setFiles(e.dataTransfer.files);
}

/* ══════════════════════════════════════════
   파일 선택 처리
══════════════════════════════════════════ */
function setFiles(fileList) {
  if (!fileList || fileList.length === 0) return;
  const ok = ['pdf', 'jpg', 'jpeg', 'png'];
  const validated = [];
  for (const f of fileList) {
    const ext = f.name.split('.').pop().toLowerCase();
    if (!ok.includes(ext)) { alert(`지원하지 않는 형식: ${f.name}`); return; }
    if (f.size > 15 * 1024 * 1024) { alert(`파일이 너무 큽니다: ${f.name} (최대 15MB)`); return; }
    validated.push(f);
  }
  selFiles = validated;

  const icon = document.getElementById('fIcon');
  const nm   = document.getElementById('fName');
  const sz   = document.getElementById('fSize');

  if (selFiles.length === 1) {
    const f = selFiles[0];
    icon.textContent = f.name.toLowerCase().endsWith('.pdf') ? '📋' : '🖼️';
    nm.textContent   = f.name;
    sz.textContent   = (f.size / 1024).toFixed(1) + ' KB';
  } else {
    icon.textContent = '📂';
    nm.textContent   = `${selFiles.length}개 파일 선택됨`;
    sz.textContent   = selFiles.map(f => f.name).join(' · ');
  }

  document.getElementById('filePrev').style.display  = 'flex';
  document.getElementById('runBtn').disabled          = false;
  document.getElementById('resultArea').innerHTML     = '';
}

function clearFile() {
  selFiles = [];
  document.getElementById('fileInput').value      = '';
  document.getElementById('filePrev').style.display = 'none';
  document.getElementById('runBtn').disabled        = true;
}

/* ══════════════════════════════════════════
   분석 실행 — OCR → K-REACH · KOSHA
══════════════════════════════════════════ */
async function doAnalyze() {
  if (!selFiles.length) return;

  document.getElementById('runBtn').disabled      = true;
  document.getElementById('resultArea').innerHTML = '';

  const pw  = document.getElementById('progWrap');
  const pf  = document.getElementById('progFill');
  const pl  = document.getElementById('progLabel');
  pw.style.display = 'block';
  let pct = 0;

  const msgs = [
    '파일 전송 중...',
    'GPT-4o가 MSDS를 읽는 중...',
    '구성성분 CAS번호·함량 추출 중...',
    'K-REACH · KOSHA 규제 조회 중...',
    '결과 정리 중...',
  ];

  const tmr = setInterval(() => {
    if (pct < 88) { pct += Math.random() * 4; pf.style.width = pct + '%'; }
    pl.textContent = msgs[Math.min(Math.floor(pct / 20), msgs.length - 1)];
  }, 500);

  try {
    const fd = new FormData();
    if (selFiles.length === 1) {
      fd.append('file', selFiles[0]);
    } else {
      selFiles.forEach(f => fd.append('files[]', f));
    }

    const r = await fetch(PROXY + '/api/msds/analyze', {
      method: 'POST',
      body:   fd,
      signal: AbortSignal.timeout(180000),
    });

    const text = await r.text();
    let d;
    try { d = JSON.parse(text); }
    catch (je) {
      clearInterval(tmr); pw.style.display = 'none';
      showError(
        `서버 응답이 JSON이 아닙니다 (HTTP ${r.status}).<br>` +
        `<pre style="font-size:10px;white-space:pre-wrap;background:#1a1a2e;color:#f87171;` +
        `padding:8px;border-radius:4px;margin-top:6px">${escHtml(text.slice(0, 500))}</pre>`
      );
      document.getElementById('runBtn').disabled = false;
      return;
    }

    clearInterval(tmr);
    pf.style.width = '100%';
    pl.textContent = '완료!';
    setTimeout(() => { pw.style.display = 'none'; pf.style.width = '0%'; }, 600);

    if (!r.ok || d.error) showError(d.error || `HTTP ${r.status}`);
    else                   renderAll(d);

  } catch (e) {
    clearInterval(tmr); pw.style.display = 'none';
    showError(e.message.includes('timeout') ? '응답 시간 초과 (180초).' : e.message);
  }

  document.getElementById('runBtn').disabled = false;
}

/* ══════════════════════════════════════════
   K-REACH 규제함량 셀
══════════════════════════════════════════ */
function buildKrConc(kr, cMax, maxIncluded) {
  if (!kr || (kr.not_found && !kr['금지'])) return `<td class="cd" title="K-REACH 미등록">—</td>`;
  if (kr.error) return `<td class="cd" title="${escAttr(kr.error)}">오류</td>`;

  if (kr['금지'] === 'Y') {
    return `<td style="background:#1a1a2e;color:#fbbf24;font-weight:700;font-size:11px;text-align:center"
      title="${escAttr(kr['금지_근거'] || '금지물질')}">완전금지</td>`;
  }

  const regs = [];
  (kr['유해_기준표'] || []).forEach(r => {
    if (r['기준값'] != null) regs.push({ name: r['카테고리'], thr: r['기준값'] });
  });
  if (kr['사고대비'] === 'Y') {
    const m = (kr['사고대비_기준'] || '').match(/(\d+(?:\.\d+)?)/);
    if (m) regs.push({ name: '사고대비', thr: parseFloat(m[1]) });
  }
  ['유독', '허가', '제한'].forEach(c => {
    if (kr[c] === 'Y') regs.push({ name: c, thr: null });
  });

  if (!regs.length) return `<td class="cd">—</td>`;

  const thrs   = regs.filter(r => r.thr != null).map(r => r.thr);
  const minThr = thrs.length ? Math.min(...thrs) : null;

  if (minThr != null && cMax != null) {
    const exceeded = maxIncluded ? cMax >= minThr : cMax > minThr;
    if (!exceeded) {
      const sign = maxIncluded ? `${cMax}% ≤` : `${cMax}% 미만`;
      return `<td class="cd" title="${sign} < 규제기준 ${minThr}%">—</td>`;
    }
  }

  const concText = minThr != null ? `${minThr}% 이상` : '해당';
  const tip      = regs.map(r => r.name + (r.thr != null ? ` ≥${r.thr}%` : '')).join(' / ');
  const excp     = (kr['유해물질_예외조건'] || '').trim();

  return `<td style="text-align:center;padding:4px 6px" title="${escAttr(tip + (excp ? ' / 예외: ' + excp : ''))}">
    <div style="font-size:12px;font-weight:700;color:var(--red)">${concText}</div>
    ${excp ? `<div style="font-size:10px;color:var(--orange);line-height:1.3;margin-top:2px">※ ${escHtml(excp)}</div>` : ''}
  </td>`;
}

/* ── K-REACH 유해성여부 셀 ── */
function buildKrHazard(kr) {
  if (!kr || (kr.not_found && !kr['금지'])) return `<td class="cd">—</td>`;
  if (kr.error) return `<td class="cd" title="${escAttr(kr.error)}">오류</td>`;

  const lines = [];
  ['유독', '허가', '제한', '중점'].forEach(c => {
    if (kr[c] === 'Y') lines.push(`<span class="tag-org">${c}</span>`);
  });
  if (kr['사고대비'] === 'Y') {
    const b = kr['사고대비_기준'] ? ` ≥${kr['사고대비_기준']}` : '';
    lines.push(`<span class="tag-org">사고대비${b}</span>`);
  }
  (kr['유해_기준표'] || []).forEach(r => {
    if (r['기준값'] != null)
      lines.push(`<span class="tag-yel">${escHtml(r['카테고리'])} ≥${r['기준값']}%</span>`);
  });

  const isHazardous = lines.length > 0;
  if (!isHazardous && kr['기존화학_ke'])
    lines.push(`<span class="tag-gray">기존 ${escHtml(kr['기존화학_ke'])}</span>`);

  if (!lines.length) return `<td class="cd">—</td>`;
  return `<td style="padding:4px 6px;text-align:left"><div style="line-height:1.8">${lines.join(' ')}</div></td>`;
}

/* ── K-REACH 고시일자 셀 ── */
function buildKrDate(kr) {
  if (!kr || kr.not_found || kr.error) return `<td class="cd">—</td>`;
  const d = kr['고시일자'] || '';
  const isHaz = ['유해판정','금지','유독','허가','제한','사고대비'].some(k => kr[k] === 'Y');
  if (!isHaz || !d) return `<td class="cd">—</td>`;
  return `<td style="text-align:center;font-size:11px;color:#374151">${d}</td>`;
}

/* ── K-REACH 고유번호 셀 ── */
function buildKrUnqNo(kr) {
  if (!kr || kr.not_found || kr.error) return `<td class="cd">—</td>`;
  const unq = (kr['유해물질_고유번호'] || '').trim();
  if (!unq) return `<td class="cd">—</td>`;
  return `<td style="text-align:center;font-size:11px;color:#374151;white-space:nowrap">${escHtml(unq)}</td>`;
}

/* ── KOSHA 규제함량 셀 ── */
function buildKoConc(ko) {
  if (!ko || ko.not_found) return `<td class="cd">—</td>`;
  if (ko.error) return `<td class="cd" title="${escAttr(ko.error)}">미응답</td>`;
  const isReg = ko['금지'] === 'Y' || ko['특별관리'] === 'Y';
  if (!isReg) return `<td class="cd">—</td>`;
  return `<td style="text-align:center;font-size:12px;font-weight:700;color:var(--red)">해당</td>`;
}

/* ── KOSHA 유해성여부 셀 ── */
function buildKoHazard(ko) {
  if (!ko || ko.not_found) return `<td class="cd">—</td>`;
  if (ko.error) return `<td class="cd" title="${escAttr(ko.error)}">미응답</td>`;
  const lines = [];
  if (ko['금지']    === 'Y') lines.push(`<span class="tag-red">금지물질</span>`);
  if (ko['특별관리'] === 'Y') lines.push(`<span class="tag-yel">특별관리</span>`);
  if (!lines.length) return `<td class="cd">—</td>`;
  return `<td style="padding:4px 6px;text-align:left"><div style="line-height:1.8">${lines.join(' ')}</div></td>`;
}

/* ══════════════════════════════════════════
   renderAll — 파일별 결과 렌더링 (버전1 스타일)
══════════════════════════════════════════ */
function renderAll(d) {
  const ra = document.getElementById('resultArea');
  const fileResults = d.results || [{ filename: d.filename || '', section2: d.section2 || {}, section3: d.section3 || [] }];

  let html = '';

  fileResults.forEach((fd, fi) => {
    const fname  = fd.filename || `파일 ${fi + 1}`;
    const s3     = fd.section3 || [];
    const hasErr = !!fd.error;

    // 다중 파일 구분선
    if (fileResults.length > 1) {
      html += `<div style="margin:${fi > 0 ? '20px' : 0} 0 10px;padding:8px 14px;background:var(--pri-dark);
        color:#fff;border-radius:var(--r);font-weight:700;font-size:13px;display:flex;align-items:center;gap:8px">
        📋 ${fi + 1}. ${escHtml(fname)}
        <span style="margin-left:auto;font-size:11px;font-weight:400;opacity:.8">${s3.length}종</span>
      </div>`;
    }

    if (hasErr) {
      html += `<div class="err-box"><strong>⚠️ ${escHtml(fname)} — OCR 오류</strong>${escHtml(fd.error)}</div>`;
      return;
    }

    // GPT 추출 결과 요약 박스
    const srcLines = s3.map(c => `CAS: ${c['cas_no'] || '—'} | 함량: ${c['함량원문'] || '—'}`);
    if (srcLines.length) {
      html += `<div style="background:#1e293b;border-radius:var(--r);padding:10px 14px;margin-bottom:12px;
        font-size:11px;font-family:monospace;color:#94a3b8;line-height:1.8">
        <div style="color:#60a5fa;font-weight:700;margin-bottom:4px;font-family:'Noto Sans KR',sans-serif;font-size:12px">
          📋 GPT 추출 결과 (${escHtml(fname)})
        </div>
        ${srcLines.map(l => `<div>${escHtml(l)}</div>`).join('')}
      </div>`;
    }

    // 통합 규제표 카드
    html += `<div class="card" style="margin-bottom:${fi < fileResults.length - 1 ? '6px' : '14px'}">
    <div class="card-head">📦 구성성분 + 규제정보 ${fileResults.length === 1 ? '— ' + escHtml(fname) : ''}
      <span class="sec-badge b-gray" style="margin-left:auto">${s3.length}종</span>
    </div>
    <div class="card-body" style="padding-top:8px">`;

    html += `<div class="tbl-wrap"><table class="reg">
      <thead>
        <tr>
          <th class="th-info" rowspan="2" style="min-width:130px">화학물질명</th>
          <th class="th-info" rowspan="2">CAS No</th>
          <th class="th-ocr"  rowspan="2">최소(%)</th>
          <th class="th-ocr"  rowspan="2">최대(%)</th>
          <th class="th-ocr"  rowspan="2" title="이하 = 최대값 포함(≤), 미만 = 최대값 미포함(&lt;)">이하/미만</th>
          <th class="th-kr"   colspan="4">화평법 (K-REACH)</th>
          <th class="th-ko"   colspan="2">산안법 (KOSHA)</th>
        </tr>
        <tr>
          <th class="th-kr" title="유해화학물질이 되는 최저 기준함량 / 예외조건">규제함량</th>
          <th class="th-kr" title="유해성 분류 / 기존화학물질 KE번호">유해성 여부</th>
          <th class="th-kr" title="유해화학물질 고시지정일자">고시일자</th>
          <th class="th-kr" title="유해화학물질 고유번호">고유번호</th>
          <th class="th-ko" title="산안법 규제 해당 여부">규제함량</th>
          <th class="th-ko" title="금지물질 / 특별관리대상물질">유해성 여부</th>
        </tr>
      </thead>
      <tbody>`;

    if (!s3.length) {
      html += `<tr><td colspan="11" style="text-align:center;color:var(--muted);padding:24px">
        구성성분 정보를 추출하지 못했습니다.</td></tr>`;
    }

    s3.forEach((comp, ci) => {
      const cas = comp['cas_no'] || '—';
      const cMin = comp['함량최소'];
      const cMax = comp['함량최대'];
      const maxIncluded = comp['최대포함여부'] !== undefined
        ? !!comp['최대포함여부']
        : !comp['미만여부'];
      const minIncluded = comp['최소포함여부'] !== undefined
        ? !!comp['최소포함여부']
        : !comp['초과여부'];
      const kr = comp.kreach || {};
      const ko = comp.kosha  || {};

      // 화학물질명
      const nmKor = (kr['화학물질명_국문'] || '').trim().replace(/^—$/, '');
      const nmEng = (kr['화학물질명_영문'] || '').trim().replace(/^—$/, '');
      let nmCell;
      if (nmKor)
        nmCell = `<td class="td-nm">${escHtml(nmKor)}${nmEng
          ? `<br><span style="font-size:10px;color:var(--muted);font-weight:400">(${escHtml(nmEng)})</span>`
          : ''}</td>`;
      else if (nmEng)
        nmCell = `<td class="td-nm">${escHtml(nmEng)}</td>`;
      else
        nmCell = `<td class="td-nm" style="color:var(--muted);font-style:italic;font-size:11px">미조회<br>
          <span style="font-size:9px">${escHtml(cas)}</span></td>`;

      const casTd = `<td class="td-cas">${escHtml(cas)}</td>`;
      const minTd = cMin != null ? `<td class="td-num">${cMin}%</td>` : `<td class="cd">—</td>`;
      const maxTd = cMax != null ? `<td class="td-num">${cMax}%</td>` : `<td class="cd">—</td>`;

      // 미만/이하 플래그
      let flagTd;
      if (cMax != null && !maxIncluded)
        flagTd = `<td style="text-align:center;font-size:12px;color:var(--orange);font-weight:700"
          title="${cMax}% 미포함 (미만 &lt; ${cMax}%)">미만</td>`;
      else if (cMin != null && !minIncluded)
        flagTd = `<td style="text-align:center;font-size:12px;color:var(--orange);font-weight:700"
          title="${cMin}% 미포함 (초과 &gt; ${cMin}%)">초과</td>`;
      else if (cMax != null)
        flagTd = `<td style="text-align:center;font-size:11px;color:#374151"
          title="${cMax}% 포함 (이하 ≤ ${cMax}%)">이하</td>`;
      else
        flagTd = `<td class="cd">—</td>`;

      html += `<tr class="${ci > 0 ? 'row-sep' : ''}">
        ${nmCell}${casTd}
        ${minTd}${maxTd}${flagTd}
        ${buildKrConc(kr, cMax, maxIncluded)}${buildKrHazard(kr)}${buildKrDate(kr)}${buildKrUnqNo(kr)}
        ${buildKoConc(ko)}${buildKoHazard(ko)}
      </tr>`;
    });

    html += `</tbody></table></div></div></div>`;
  });

  // GPT·API 응답 원문 토글
  const uid = 'raw-' + Math.random().toString(36).slice(2, 6);
  html += `<div style="text-align:right;margin-top:4px">
    <button class="raw-toggle" onclick="toggleEl('${uid}')">▼ GPT·API 응답 원문 보기</button>
    <div id="${uid}" class="raw-box">${escHtml(JSON.stringify(d, null, 2))}</div>
  </div>`;

  ra.innerHTML = html;
  ra.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ══════════════════════════════════════════
   유틸리티
══════════════════════════════════════════ */
function showError(msg) {
  document.getElementById('resultArea').innerHTML = `
  <div class="err-box">
    <strong>⚠️ 분석 오류</strong>${msg}<br><br>
    확인: <code>api_gpt.py</code> OPENAI_KEY · OpenAI 크레딧 잔액 ·
    PDF이면 <code>pip install pypdf</code>
  </div>`;
}

function toggleEl(id) {
  const el = document.getElementById(id);
  el.style.display = el.style.display === 'block' ? 'none' : 'block';
}

function escHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escAttr(s) {
  return (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
