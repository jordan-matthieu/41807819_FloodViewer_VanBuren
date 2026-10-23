/* Standalone flood atlas: deliberately uses no network requests or dependencies. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const sourceData = window.FLOOD_DATA;
  const context = window.FLOOD_CONTEXT;
  const contextFrames = new Map((context?.frames || []).map((frame) => [Number(frame.sourceIndex),frame]));
  const hasContext = Boolean(context?.width > 0 && context?.height > 0 && sourceData?.frames?.length && sourceData.frames.every((frame) => contextFrames.has(Number(frame.sourceIndex))));
  const graphicFields = ['shoreline','shorelineOutline','raw','added','removed','depths','hybrid','transparency','rawDepths','rawBands','rawHybrid','rawTransparency','strandedPath','strandedOutline','exposedBuildingsPath','rawExposedBuildingsPath','activeAreaHa','strandedAreaHa','touchedBuildingCount','rawTouchedBuildingCount'];
  const data = hasContext ? {
    ...sourceData,
    ...Object.fromEntries(['bounds','width','height','background','backgrounds','overlay','buildingPaths','contextPaths','transparency'].filter((key) => context[key] !== undefined).map((key) => [key,context[key]])),
    sources:[...new Map([...(sourceData.sources || []),...(context.sources || [])].filter((source) => source?.url).map((source) => [source.url,source])).values()],
    frames:sourceData.frames.map((frame) => {
      const graphics = contextFrames.get(Number(frame.sourceIndex));
      return {...frame,...Object.fromEntries(graphicFields.filter((key) => graphics[key] !== undefined).map((key) => [key,graphics[key]]))};
    })
  } : sourceData;
  const ns = 'http://www.w3.org/2000/svg';
  const number = (value, places = 1) => Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value).toLocaleString('en', {minimumFractionDigits: places, maximumFractionDigits: places}) : '—';
  const setText = (id, value) => { const element = $(id);if (element) element.textContent = value; };

  if (!data || !Array.isArray(data.frames) || !data.frames.length) {
    $('map-empty').querySelector('strong').textContent = 'The flood data is not available yet';
    $('map-empty').querySelector('p').textContent = 'Reload this page. If the map still does not load, contact the person hosting this viewer.';
    setText('date-display', 'Data file not loaded');
    document.querySelectorAll('button, input, select').forEach((control) => { control.disabled = true; });
    document.querySelectorAll('.export-actions a').forEach((link) => { link.removeAttribute('href'); link.classList.add('is-disabled'); });
    return;
  }

  const frames = data.frames;
  const width = Number(data.width) || Number(data.bounds?.[2] - data.bounds?.[0]) || 2550;
  const height = Number(data.height) || Number(data.bounds?.[3] - data.bounds?.[1]) || 2260;
  document.body.classList.toggle('has-expanded-context',hasContext);
  const originalBounds = hasContext ? context.originalBounds : data.originalBounds;
  const constrainViewport = hasContext || Boolean(originalBounds);
  const boundsView = originalBounds && data.bounds ? {x:originalBounds[0] - data.bounds[0],y:data.bounds[3] - originalBounds[3],width:originalBounds[2] - originalBounds[0],height:originalBounds[3] - originalBounds[1]} : {x:0,y:0,width,height};
  const initialView = {...boundsView,...data.initialViewBox};
  const svg = $('map');
  let current = 0;
  let mode = 'refined';
  let waterStyle = ['hybrid','uniform','transparency','bands'].includes(data.initialFill) ? data.initialFill : data.initialDepth === true ? 'bands' : 'uniform';
  const hybrid = {baseOpacity:.65,shallowOpacity:.60,deepOpacity:.70,fullOpacityDepthM:2,...data.hybrid};
  const strandedColor = data.strandedColor || '#8b9295';
  const exposedBuildingColor = data.exposedBuildingColor || '#8a2f3c';
  const confidence = window.FLOOD_CONFIDENCE;
  const confidenceFrames = new Map((confidence?.frames || []).map((frame) => [Number(frame.sourceIndex),frame]));
  const confidenceLabels = {boundaryDistance:'Distance beyond modelled flood edge',laterSupport:'Earlier / later model flooding'};
  const confidenceDescriptions = {
    evidence:'Combines distance with support from the two model runs. Closer means within 50 m of the source cell and 25 m of the current modelled wet extent. Event support means either run records a wet model cell here at another time. These are project review classes, not probabilities.',
    sourceDistance:'Straight-line distance to the nearest currently eligible source in the eight-source spatial blend, before the spatial Gaussian and coarse-cell wet/dry head constraint. This is neither a weighted-effective source distance nor the distance to the farthest contributor. Native source heads are unchanged.',
    boundaryDistance:'How far each addition lies beyond the modelled wet extent at the selected time. This is a straight-line distance, rather than a flow path or channel length.',
    laterSupport:'Shows whether the 0.01 m results contain water in the same model cell earlier or later in the event. This supports the mapped reach, but does not confirm water at this ground location at the selected time. The full event is checked, including outputs before this viewer starts.',
    scenarioSupport:'Shows whether the original 0.10 m run, the 0.01 m run, or both record water in the same model cell at any time in the full event. The runs differ in both their simulated shallow-water behaviour and which wet cells are saved. Agreement is supporting model evidence, rather than an observation.'
  };
  const confidenceMetrics = (confidence?.metrics || []).map((metric) => ({...metric,label:confidenceLabels[metric.id] || metric.label,description:confidence?.descriptionOverrides?.[metric.id] || confidenceDescriptions[metric.id] || metric.description}));
  let confidenceMetric = confidenceMetrics[0]?.id || '';
  let activeFrame = null;
  let drawRequest = 0;
  let requestedIndex = 0;
  const detailCache = new Map();
  const detailRequests = new Map();
  const imageCache = new Map();
  window.FLOOD_FRAME_DETAILS = window.FLOOD_FRAME_DETAILS || {};
  let playing = false;
  let timer = null;
  let split = .5;
  let viewport = {...initialView};
  let pointer = null;
  let dividerPointer = null;
  let announceTimer = null;
  const valueOf = (frame) => Number(frame.lakeWse ?? frame.areaHa ?? 0);
  const peak = Number.isInteger(data.peakIndex) ? Math.max(0, Math.min(frames.length - 1, data.peakIndex)) : frames.reduce((best, frame, index) => valueOf(frame) > valueOf(frames[best]) ? index : best, 0);
  current = Number.isInteger(data.initialIndex) ? Math.max(0, Math.min(frames.length - 1, data.initialIndex)) : peak;
  const locationOptions = new URLSearchParams(window.location.search);
  const sourceOption = locationOptions.get('source');
  if (sourceOption !== null && sourceOption.trim() !== '') {
    const selected = frames.findIndex((frame) => Number(frame.sourceIndex) === Number(sourceOption));
    if (selected >= 0) current = selected;
  }
  if (['refined','raw','split','changes','confidence'].includes(locationOptions.get('view'))) mode = locationOptions.get('view');
  requestedIndex = current;

  function trimCache(cache, maximum) {
    while (cache.size > maximum) cache.delete(cache.keys().next().value);
  }

  async function frameDetails(index) {
    const metadata = frames[index];
    if (!metadata.frameData) return metadata;
    const key = Number(metadata.sourceIndex);
    if (detailCache.has(key)) {
      const cached = detailCache.get(key);detailCache.delete(key);detailCache.set(key,cached);return cached;
    }
    if (detailRequests.has(key)) return detailRequests.get(key);
    const request = new Promise((resolve,reject) => {
      const script = document.createElement('script');
      script.src = metadata.frameData;
      script.onload = () => {
        const details = window.FLOOD_FRAME_DETAILS?.[key];
        script.remove();
        if (!details) { reject(new Error(`Frame ${key} has no geometry data.`));return; }
        const frame = {...metadata,...details};
        delete window.FLOOD_FRAME_DETAILS[key];
        detailCache.set(key,frame);trimCache(detailCache,8);resolve(frame);
      };
      script.onerror = () => { script.remove();reject(new Error(`Could not load ${metadata.frameData}.`)); };
      document.head.append(script);
    });
    detailRequests.set(key,request);
    try { return await request; } finally { detailRequests.delete(key); }
  }

  function preloadImage(url) {
    if (!url) return Promise.resolve();
    if (imageCache.has(url)) return imageCache.get(url);
    const request = new Promise((resolve,reject) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`Could not load map image ${url}.`));
      img.src = url;
    });
    imageCache.set(url,request);trimCache(imageCache,24);
    return request.catch((error) => { imageCache.delete(url);throw error; });
  }

  function confidenceFrame(frame) { return confidenceFrames.get(Number(frame.sourceIndex)); }

  function activeImages(frame) {
    const urls = [];
    if (mode !== 'raw' && mode !== 'changes') {
      if (waterStyle === 'hybrid') urls.push(frame.hybrid);
      if (waterStyle === 'transparency') urls.push(frame.transparency);
    }
    if (['raw','split'].includes(mode)) {
      if (waterStyle === 'bands') urls.push(frame.rawBands);
      if (waterStyle === 'hybrid') urls.push(frame.rawHybrid);
      if (waterStyle === 'transparency') urls.push(frame.rawTransparency);
    }
    if (mode === 'confidence') urls.push(confidenceFrame(frame)?.images?.[confidenceMetric]);
    return urls.filter(Boolean);
  }

  function path(d, attributes = {}) {
    const element = document.createElementNS(ns, 'path');
    element.setAttribute('d', d || '');
    element.setAttribute('fill-rule', 'evenodd');
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  }

  function literalTime(frame) {
    const raw = String(frame.time || frame.label || '');
    const match = raw.match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!match) return {date: frame.label || raw || `Step ${current + 1}`, time: '', short: frame.label || raw};
    const month = ['January','February','March','April','May','June','July','August','September','October','November','December'][Number(match[2]) - 1];
    const minute = `${match[4]}:${match[5]}`;
    return {date: `${Number(match[3])} ${month} ${match[1]}`, time: minute, short: `${Number(match[3])} ${month.slice(0,3)} · ${minute}`};
  }

  function setLink(id, href) {
    const link = $(id);
    if (href) { link.href = href; link.classList.remove('is-disabled'); link.removeAttribute('aria-disabled'); }
    else { link.removeAttribute('href'); link.classList.add('is-disabled'); link.setAttribute('aria-disabled', 'true'); }
  }

  async function drawFrame(index, announce = true) {
    const request = ++drawRequest;
    const next = Math.max(0, Math.min(frames.length - 1, Number(index) || 0));
    requestedIndex = next;
    $('time-slider').value = next;
    $('map-container').setAttribute('aria-busy','true');
    const statusTimer = setTimeout(() => {
      if (request !== drawRequest) return;
      setText('asset-status','Loading time step…');$('asset-status').hidden = false;
    },200);
    let frame;
    try {
      frame = await frameDetails(next);
      if (request !== drawRequest) { clearTimeout(statusTimer);return false; }
      await Promise.all(activeImages(frame).map(preloadImage));
    } catch (error) {
      if (request === drawRequest) {
        stop();setText('asset-status',`${error.message} Keep the complete viewer folder together, then retry the time step.`);$('asset-status').hidden = false;
        $('map-container').setAttribute('aria-busy','false');
      }
      clearTimeout(statusTimer);return false;
    }
    clearTimeout(statusTimer);
    if (request !== drawRequest) return false;
    current = next;activeFrame = frame;
    $('asset-status').hidden = true;
    $('map-container').setAttribute('aria-busy','false');
    $('map-container').dataset.sourceIndex = frame.sourceIndex;
    $('map-container').dataset.mode = mode;
    const time = literalTime(frame);
    $('time-slider').value = current;
    $('time-slider').setAttribute('aria-valuetext', `${time.date} ${time.time}; lake level ${number(frame.lakeWse,2)} metres IGLD85`);
    $('time-slider').style.background = `linear-gradient(to right, #517d78 ${frames.length > 1 ? current / (frames.length - 1) * 100 : 0}%, #ccd6ca 0)`;
    setText('step-tag', `${current + 1} / ${frames.length}`);
    $('step-tag').title = `Original output time step ${Number(frame.sourceIndex) + 1}; displayed frame ${current + 1} of ${frames.length}`;
    setText('date-display', time.date);
    setText('time-display', time.time || frame.label || '');
    setText('water-level', number(frame.lakeWse,2));
    setText('wet-area', number(frame.areaHa));
    const reconstructionAvailable = frame.strandedPath !== undefined || frame.strandedAreaHa !== undefined || Boolean(data.reconstructionSummary);
    $('water-state-note').hidden = !reconstructionAvailable;
    setText('water-state-note', `Connected: ${number(frame.activeAreaHa)} ha · Disconnected / stranded (estimated): ${number(frame.strandedAreaHa)} ha`);
    $('flood-buildings-row').hidden = frame.exposedBuildingsPath === undefined && frame.rawExposedBuildingsPath === undefined;
    setText('raw-area', `${number(frame.rawAreaHa)} ha`);
    setText('removed-area', `${number(frame.removedPondHa)} ha`);
    setText('source-distance', `${number(frame.sourceDistanceP95,0)} m`);
    $('raw-path').setAttribute('d', frame.raw || '');
    $('refined-path').setAttribute('d', frame.shoreline || '');
    $('shoreline-path').setAttribute('d', frame.shorelineOutline || frame.shoreline || '');
    $('added-path').setAttribute('d', frame.added || '');
    $('removed-path').setAttribute('d', frame.removed || '');
    $('stranded-path').setAttribute('d',frame.strandedPath || '');
    $('stranded-outline').setAttribute('d',frame.strandedOutline || frame.strandedPath || '');
    $('flood-buildings-path').setAttribute('d',frame.exposedBuildingsPath || '');
    $('raw-flood-buildings-path').setAttribute('d',frame.rawExposedBuildingsPath || '');
    $('depth-layer').replaceChildren(...(frame.depths || []).map((band) => path(band.path || band.d, {fill: band.color || '#4597b6'})));
    $('raw-depth-layer').replaceChildren(...(frame.rawDepths || []).map((band) => path(band.path || band.d, {fill: band.color || '#4597b6'})));
    if (frame.transparency) $('transparency-image').setAttribute('href',frame.transparency);
    else $('transparency-image').removeAttribute('href');
    if (frame.hybrid) $('hybrid-image').setAttribute('href',frame.hybrid);
    else $('hybrid-image').removeAttribute('href');
    [['raw-transparency-image','rawTransparency'],['raw-hybrid-image','rawHybrid'],['raw-bands-image','rawBands']].forEach(([id,key]) => {
      if (frame[key]) $(id).setAttribute('href',frame[key]);else $(id).removeAttribute('href');
    });
    setLink('qc-link', frame.qc);
    $('first-button').disabled = current === 0;
    $('previous-button').disabled = current === 0;
    $('next-button').disabled = current === frames.length - 1;
    setText('map-title', `${data.title || 'Lake Erie flood'}: ${time.date} ${time.time}, ${mode} view`);
    setText('print-note', `${time.date} ${time.time} · ${data.timezone || 'Model time (timezone unspecified)'}. Lake level: ${number(frame.lakeWse,2)} m IGLD85. Refined wet area: ${number(frame.areaHa)} ha. Terrain-refined visualization; building footprints are cartographic stencils. Review alongside the original model and QC maps.`);
    $('peak-button').textContent = current === peak ? 'At peak flood extent' : 'Jump to peak ↗';
    updateLayers();
    if (announce && !playing) {
      clearTimeout(announceTimer);
      announceTimer = setTimeout(() => { setText('live-status', `${time.date}, ${time.time}. Lake level ${number(frame.lakeWse,2)} metres IGLD85. Refined wet area ${number(frame.areaHa)} hectares.`); }, 180);
    }
    if (current + 1 < frames.length) {
      frameDetails(current + 1).then((nextFrame) => Promise.all(activeImages(nextFrame).map(preloadImage))).catch(() => {});
    }
    return true;
  }

  function updateLayers() {
    const frame = activeFrame;
    if (!frame) return;
    const useTransparency = waterStyle === 'transparency' && Boolean(frame.transparency);
    const useHybrid = waterStyle === 'hybrid' && Boolean(frame.hybrid);
    const useDepth = waterStyle === 'bands' && (frame.depths || []).length > 0;
    const rawTransparency = waterStyle === 'transparency' && Boolean(frame.rawTransparency);
    const rawHybrid = waterStyle === 'hybrid' && Boolean(frame.rawHybrid);
    const rawDepth = waterStyle === 'bands' && ((frame.rawDepths || []).length > 0 || Boolean(frame.rawBands));
    const showRefined = mode !== 'raw' && mode !== 'changes';
    const splitView = mode === 'split';
    $('fill-style-select').value = waterStyle;
    $('map-container').dataset.mode = mode;
    $('raw-layer').style.display = ['raw','split','changes'].includes(mode) ? '' : 'none';
    $('refined-layer').style.display = mode === 'raw' || mode === 'changes' ? 'none' : '';
    $('changes-layer').style.display = mode === 'changes' ? '' : 'none';
    $('depth-layer').style.display = useDepth ? '' : 'none';
    $('transparency-image').style.display = useTransparency ? '' : 'none';
    $('hybrid-image').style.display = useHybrid ? '' : 'none';
    $('raw-depth-layer').style.display = rawDepth ? '' : 'none';
    $('raw-bands-image').style.display = rawDepth && frame.rawBands ? '' : 'none';
    $('raw-transparency-image').style.display = rawTransparency ? '' : 'none';
    $('raw-hybrid-image').style.display = rawHybrid ? '' : 'none';
    $('raw-path').style.display = mode !== 'changes' && (rawTransparency || rawHybrid || rawDepth) ? 'none' : '';
    $('refined-path').style.display = useTransparency || useHybrid ? 'none' : '';
    $('refined-path').style.fillOpacity = useDepth ? '0.13' : '1';
    $('buildings-layer').style.display = $('buildings-toggle').checked ? '' : 'none';
    const showStranded = mode !== 'raw' && Boolean(frame.strandedPath);
    const highlightBuildings = $('flood-buildings-toggle').checked;
    $('stranded-layer').style.display = showStranded ? '' : 'none';
    $('flood-buildings-path').style.display = highlightBuildings && mode !== 'raw' ? '' : 'none';
    $('raw-flood-buildings-path').style.display = highlightBuildings && ['raw','split'].includes(mode) ? '' : 'none';
    const contactCount = mode === 'split' ? `Raw ${number(frame.rawTouchedBuildingCount,0)} · Refined ${number(frame.touchedBuildingCount,0)}` : mode === 'raw' ? `${number(frame.rawTouchedBuildingCount,0)} raw` : `${number(frame.touchedBuildingCount,0)} refined`;
    setText('flood-buildings-note', `Footprint contact, not damage · Full map: ${contactCount} this step`);
    $('raw-path').style.fillOpacity = mode === 'changes' ? '.24' : '1';
    const opacity = Number($('opacity-slider').value) / 100;
    ['raw-layer','refined-layer','changes-layer'].forEach((id) => { $(id).style.opacity = opacity; });
    $('stranded-layer').style.opacity = opacity;
    if (useHybrid) $('refined-layer').style.opacity = 1;
    if (rawHybrid && mode !== 'changes') $('raw-layer').style.opacity = 1;
    $('hybrid-opacity-function').setAttribute('slope',opacity / Math.max(.01,hybrid.baseOpacity));
    $('shoreline-path').style.strokeOpacity = useHybrid ? opacity * .8 : .8;
    setText('opacity-output',`${Math.round(opacity * 100)}%`);
    if (splitView) {
      ['raw-layer','raw-flood-buildings-path'].forEach((id) => $(id).setAttribute('clip-path','url(#raw-clip)'));
      ['refined-layer','stranded-layer','flood-buildings-path'].forEach((id) => $(id).setAttribute('clip-path','url(#refined-clip)'));
    } else {
      ['raw-layer','refined-layer','stranded-layer','flood-buildings-path','raw-flood-buildings-path'].forEach((id) => $(id).removeAttribute('clip-path'));
    }
    ['split-labels','split-divider'].forEach((id) => { $(id).hidden = !splitView; });
    const showWaterLegend = mode !== 'changes' && mode !== 'confidence';
    $('depth-legend').hidden = !(useDepth || useHybrid || rawDepth || rawHybrid) || !showWaterLegend;
    $('depth-legend').querySelector('p').firstChild.textContent = mode !== 'raw' && frame.activeAreaHa !== undefined ? 'ACTIVE WATER DEPTH ' : 'WATER DEPTH ';
    $('hybrid-caption').hidden = !useHybrid;
    setText('hybrid-caption',`${Math.round(opacity * 100)}% opacity · gentle depth variation`);
    $('legend-swatches').querySelectorAll('i').forEach((swatch,index,swatches) => { swatch.style.opacity = useHybrid ? Math.min(1,(hybrid.shallowOpacity + (hybrid.deepOpacity - hybrid.shallowOpacity) * index / Math.max(1,swatches.length - 1)) * opacity / hybrid.baseOpacity) : 1; });
    $('transparency-legend').hidden = !(useTransparency || rawTransparency) || !showWaterLegend;
    setText('transparency-legend-title','DEPTH-BASED OPACITY');
    $('transparency-swatches').querySelectorAll('i').forEach((swatch,index,swatches) => { swatch.style.opacity = (transparency.shallowOpacity + (transparency.deepOpacity - transparency.shallowOpacity) * index / Math.max(1,swatches.length - 1)) * opacity; });
    setText('transparency-caption',`${Math.round(transparency.shallowOpacity * opacity * 100)}% visible at 0 m · ${Math.round(transparency.deepOpacity * opacity * 100)}% at ${transparency.fullOpacityDepthM} m`);
    $('changes-legend').hidden = mode !== 'changes';
    $('extent-legend').hidden = !showWaterLegend || (useDepth || useTransparency || useHybrid || rawDepth || rawTransparency || rawHybrid);
    setText('extent-label', mode === 'raw' ? 'Original model wet cells' : frame.activeAreaHa !== undefined ? 'Connected to lake' : mode === 'split' ? 'Raw / refined inundation' : 'Refined inundation');
    const exportImage = useHybrid && showRefined ? frame.hybridPng : useTransparency && showRefined ? frame.transparencyPng : frame.png;
    setLink('frame-link',exportImage || frame.png);
    $('frame-link').title = highlightBuildings ? 'The new print view starts with baseline building stencils. Use Print this view to include the current red building highlights.' : 'Open a print view with baseline building stencils.';
    updateConfidence(frame,opacity);
    updateWaterStateKey(frame,opacity);
    const time = literalTime(frame);
    setText('print-note', `${time.date} ${time.time} · ${data.timezone || 'Model time (timezone unspecified)'}. Lake level: ${number(frame.lakeWse,2)} m IGLD85.${mode === 'raw' ? ` Native wet area: ${number(frame.rawAreaHa)} ha.` : ` Refined wet area: ${number(frame.areaHa)} ha.`}${mode !== 'raw' && frame.activeAreaHa !== undefined ? ` Connected: ${number(frame.activeAreaHa)} ha; disconnected / stranded (estimated): ${number(frame.strandedAreaHa)} ha. Grey: previously inundated; no current mapped connection to the lake. Estimated from terrain reconstruction, not a modelled pond level.` : ''}${highlightBuildings ? ` Dark red marks current flood-touched building footprints (full-map counts): ${contactCount}.${mode === 'split' ? ' Each dataset is shown on its corresponding comparison side.' : ''} Contact does not establish damage or water inside a structure.` : ' Building footprints are cartographic stencils.'} Review alongside the original model and QC maps.`);
    document.querySelectorAll('[data-mode]').forEach((button) => { const active = button.dataset.mode === mode; button.classList.toggle('active', active); button.setAttribute('aria-pressed',String(active)); });
    updateSplit();
  }

  function updateWaterStateKey(frame,opacity) {
    document.querySelectorAll('.water-state-key').forEach((key) => key.remove());
    const legend = ['depth-legend','transparency-legend','changes-legend','extent-legend','confidence-legend'].map($).find((element) => !element.hidden);
    if (!legend) return;
    const rows = [];
    if (mode !== 'raw' && mode !== 'changes' && frame.activeAreaHa !== undefined && $('extent-legend').hidden) {
      rows.push({color:'#5ba1bf',label:'Connected to lake',opacity});
    }
    if (mode !== 'raw' && frame.strandedAreaHa !== undefined) rows.push({color:strandedColor,label:'Disconnected / stranded water (estimated)',opacity});
    if ($('flood-buildings-toggle').checked) rows.push({color:exposedBuildingColor,label:mode === 'split' ? 'Flood-touched building (per side)' : 'Flood-touched building',opacity:1});
    if (data.unsupportedPath) rows.push({color:'repeating-linear-gradient(135deg,#a1957d 0,#a1957d 1px,#f6f2e8 1px,#f6f2e8 4px)',label:'Outside model coverage — no flood assessment',opacity:1});
    if (!rows.length) return;
    const key = document.createElement('div');key.className = 'water-state-key';
    rows.forEach((entry) => {
      const row = document.createElement('div');const swatch = document.createElement('i');const label = document.createElement('span');
      swatch.style.background = entry.color;swatch.style.opacity = entry.opacity;label.textContent = entry.label;row.append(swatch,label);key.append(row);
    });
    legend.append(key);
  }

  function updateConfidence(frame,opacity) {
    const visible = mode === 'confidence';
    $('confidence-controls').hidden = !visible;
    $('confidence-legend').hidden = !visible;
    $('confidence-image').style.display = visible ? '' : 'none';
    if (!visible) return;
    const metric = confidenceMetrics.find((entry) => entry.id === confidenceMetric);
    const diagnostic = confidenceFrame(frame);
    const url = diagnostic?.images?.[confidenceMetric];
    const diagnosticBounds = diagnostic?.bounds || confidence?.bounds || data.bounds;
    if (diagnosticBounds && data.bounds) {
      const box = {x:diagnosticBounds[0] - data.bounds[0],y:data.bounds[3] - diagnosticBounds[3],width:diagnosticBounds[2] - diagnosticBounds[0],height:diagnosticBounds[3] - diagnosticBounds[1]};
      Object.entries(box).forEach(([key,value]) => $('confidence-image').setAttribute(key,value));
    }
    if (url) $('confidence-image').setAttribute('href',url);else $('confidence-image').removeAttribute('href');
    $('confidence-image').style.opacity = opacity;
    setText('confidence-description',metric?.description || 'Confidence diagnostics are not available in this viewer package.');
    setText('confidence-legend-title',metric?.label || 'MAPPING SUPPORT');
    $('confidence-legend-items').replaceChildren(...(metric?.legend || []).map((entry) => {
      const row = document.createElement('div');const swatch = document.createElement('i');swatch.style.background = entry.color;
      const label = document.createElement('span');label.textContent = entry.label;row.append(swatch,label);return row;
    }));
    setText('confidence-frame-note','Blue keeps the selected active flood style (unscored). Grey shows previously inundated areas with no current mapped connection to the lake; it is estimated from terrain reconstruction, not a modelled pond level. Grey areas are separate from the addition diagnostics. Areas below cover the full panning extent. ' + (diagnostic?.summaries?.[confidenceMetric] || diagnostic?.summary || 'Diagnostic colours apply to terrain-refined additions.'));
  }

  function visibleExtent() {
    const box = svg.getBoundingClientRect();
    const fit = Math.min(box.width / viewport.width, box.height / viewport.height);
    if (!Number.isFinite(fit) || fit <= 0) return {...viewport,scale:1};
    return {x: viewport.x - (box.width / fit - viewport.width) / 2, y: viewport.y - (box.height / fit - viewport.height) / 2, width: box.width / fit, height: box.height / fit, scale:fit};
  }

  function updateSplit() {
    const extent = visibleExtent();
    const containerBox = $('map-container').getBoundingClientRect();
    const svgBox = svg.getBoundingClientRect();
    const imageBox = {right:svgBox.left + (Math.min(width,viewport.x + viewport.width) - extent.x) * extent.scale,bottom:svgBox.top + (Math.min(height,viewport.y + viewport.height) - extent.y) * extent.scale};
    const right = Math.min(Math.max(12,containerBox.width - 236),Math.max(12,containerBox.right - Math.min(containerBox.right,imageBox.right) + 16));
    const bottom = Math.min(Math.max(12,containerBox.height - 160),Math.max(12,containerBox.bottom - Math.min(containerBox.bottom,imageBox.bottom) + 16));
    $('map-container').style.setProperty('--map-overlay-right',`${right}px`);
    $('map-container').style.setProperty('--map-overlay-bottom',`${bottom}px`);
    const dividingX = extent.x + extent.width * split;
    const rects = [[$('raw-clip-rect'),extent.x,dividingX - extent.x],[$('refined-clip-rect'),dividingX,extent.x + extent.width - dividingX]];
    rects.forEach(([rect,x,w]) => { rect.setAttribute('x',x);rect.setAttribute('y',extent.y);rect.setAttribute('width',Math.max(0,w));rect.setAttribute('height',extent.height); });
    $('split-divider').style.left = `${split * 100}%`;
    $('split-divider').setAttribute('aria-valuenow',Math.round(split * 100));
    $('split-divider').setAttribute('aria-valuetext',`${Math.round(split * 100)} percent raw model, ${Math.round((1 - split) * 100)} percent terrain refined`);
  }

  function updateViewport() {
    if (constrainViewport) {
      viewport.x = viewport.width >= width ? (width - viewport.width) / 2 : Math.max(0,Math.min(width - viewport.width,viewport.x));
      viewport.y = viewport.height >= height ? (height - viewport.height) / 2 : Math.max(0,Math.min(height - viewport.height,viewport.y));
    }
    svg.setAttribute('viewBox',`${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`);
    Object.entries(viewport).forEach(([key,value]) => $('viewport-clip-rect').setAttribute(key,value));
    updateSplit();
    const extent = visibleExtent();
    const target = 90 / extent.scale;
    const magnitude = Math.pow(10,Math.floor(Math.log10(target)));
    const mantissa = target / magnitude;
    const distance = (mantissa >= 5 ? 5 : mantissa >= 2 ? 2 : 1) * magnitude;
    $('scale-bar').style.width = `${Math.round(distance * extent.scale)}px`;
    setText('scale-label', distance >= 1000 ? `${number(distance / 1000,distance % 1000 ? 1 : 0)} km` : `${number(distance,distance < 1 ? 1 : 0)} m`);
  }

  function zoom(factor, screenX, screenY) {
    const fullContextScale = Math.max(width / initialView.width,height / initialView.height);
    const maximumWidth = constrainViewport ? initialView.width * fullContextScale : width * 2;
    const newWidth = Math.max(initialView.width / 40, Math.min(maximumWidth,viewport.width * factor));
    const actual = newWidth / viewport.width;
    const rect = svg.getBoundingClientRect();
    const extent = visibleExtent();
    const originX = screenX === undefined ? viewport.x + viewport.width / 2 : extent.x + (screenX - rect.left) / extent.scale;
    const originY = screenY === undefined ? viewport.y + viewport.height / 2 : extent.y + (screenY - rect.top) / extent.scale;
    viewport = {x:originX + (viewport.x - originX) * actual, y:originY + (viewport.y - originY) * actual, width:newWidth, height:viewport.height * actual};
    updateViewport();
  }

  function stop() {
    playing = false;
    clearTimeout(timer);
    $('play-button').setAttribute('aria-label','Play animation');
    $('play-button').setAttribute('aria-pressed','false');
    $('play-icon').innerHTML = '<path d="m7 4 9 6-9 6Z"/>';
  }

  async function tick() {
    if (!playing) return;
    if (current === frames.length - 1) { stop(); return; }
    await drawFrame(current + 1,false);
    if (playing) timer = setTimeout(tick,600 / Number($('speed-select').value));
  }

  function togglePlayback() {
    if (playing) { stop(); return; }
    if (current === frames.length - 1) { drawFrame(0,false).then(() => { if (playing) timer = setTimeout(tick,600 / Number($('speed-select').value)); }); }
    playing = true;
    $('play-button').setAttribute('aria-label','Pause animation');
    $('play-button').setAttribute('aria-pressed','true');
    $('play-icon').innerHTML = '<path d="M5 4h3v12H5zM12 4h3v12h-3z"/>';
    if (current !== frames.length - 1) timer = setTimeout(tick,600 / Number($('speed-select').value));
  }

  function step(delta) { stop(); drawFrame(requestedIndex + delta); }

  document.title = data.title + ' · 41807819';
  if (data.methodSummary) setText('method-summary',data.methodSummary);
  if (data.buildingsSummary) setText('buildings-summary',data.buildingsSummary);
  if (data.reconstructionSummary) { setText('reconstruction-summary',data.reconstructionSummary);$('reconstruction-summary').hidden = false; }
  if (data.levelNote) setText('level-note',data.levelNote);
  if (data.notes?.length) setText('uncertainty-note',data.notes.join(' '));
  if (confidence?.methodSummary) { setText('confidence-method-summary',confidence.methodSummary);$('confidence-method-summary').hidden = false; }
  if (data.unsupportedPath) {
    $('unsupported-coverage-path').setAttribute('d',data.unsupportedPath);
    setText('coverage-note','Outside model coverage — no flood assessment. ' + data.unsupportedDescription);
    $('coverage-note').hidden = false;
  }
  $('context-note').hidden = !constrainViewport;
  $('fill-style-select').value = waterStyle;
  const transparency = {color:'#5ba1bf',shallowOpacity:.2,deepOpacity:1,fullOpacityDepthM:2,...data.transparency};
  ['refined-path','raw-path'].forEach((id) => { $(id).style.fill = transparency.color; });
  $('extent-legend').querySelector('i').style.background = transparency.color;
  $('stranded-path').style.fill = strandedColor;
  $('stranded-outline').style.stroke = strandedColor;
  $('flood-buildings-path').style.fill = exposedBuildingColor;
  $('raw-flood-buildings-path').style.fill = exposedBuildingColor;
  $('transparency-image').setAttribute('width',width);$('transparency-image').setAttribute('height',height);
  $('hybrid-image').setAttribute('width',width);$('hybrid-image').setAttribute('height',height);
  ['raw-hybrid-image','raw-transparency-image','raw-bands-image'].forEach((id) => { $(id).setAttribute('width',width);$(id).setAttribute('height',height); });
  const confidenceBounds = confidence?.bounds || data.bounds;
  if (confidenceBounds && data.bounds) {
    const confidenceBox = {x:confidenceBounds[0] - data.bounds[0],y:data.bounds[3] - confidenceBounds[3],width:confidenceBounds[2] - confidenceBounds[0],height:confidenceBounds[3] - confidenceBounds[1]};
    Object.entries(confidenceBox).forEach(([key,value]) => $('confidence-image').setAttribute(key,value));
  }
  confidenceMetrics.forEach((metric) => { const option = document.createElement('option');option.value = metric.id;option.textContent = metric.label;$('confidence-select').append(option); });
  $('confidence-select').disabled = !confidenceMetrics.length;
  const hasTransparency = frames.some((frame) => Boolean(frame.transparency));
  $('fill-style-select').querySelector('[value="transparency"]').disabled = !hasTransparency;
  const hasHybrid = frames.some((frame) => Boolean(frame.hybrid));
  $('fill-style-select').querySelector('[value="hybrid"]').disabled = !hasHybrid;
  if (!hasTransparency && waterStyle === 'transparency') { waterStyle = 'uniform';$('fill-style-select').value = waterStyle; }
  if (!hasHybrid && waterStyle === 'hybrid') { waterStyle = 'uniform';$('fill-style-select').value = waterStyle; }
  $('opacity-slider').value = Number(data.initialOpacity ?? Math.round(hybrid.baseOpacity * 100));
  for (let index = 0; index < 5; index++) {
    const swatch = document.createElement('i');swatch.style.background = transparency.color;swatch.style.opacity = transparency.shallowOpacity + (transparency.deepOpacity - transparency.shallowOpacity) * index / 4;$('transparency-swatches').append(swatch);
    const label = document.createElement('span');label.textContent = `${Number((transparency.fullOpacityDepthM * index / 4).toFixed(2))}${index === 4 ? '+' : ''}`;$('transparency-labels').append(label);
  }
  setText('transparency-caption',`${Math.round(transparency.shallowOpacity * 100)}% visible at 0 m · ${Math.round(transparency.deepOpacity * 100)}% at ${transparency.fullOpacityDepthM} m`);
  $('map-background').setAttribute('href',data.background || 'assets/background.png');
  $('map-background').setAttribute('width',width);
  $('map-background').setAttribute('height',height);
  const backgrounds = data.backgrounds || [{label:'Terrain',url:data.background || 'assets/background.png'}];
  backgrounds.forEach((background,index) => { const option = document.createElement('option');option.value = index;option.textContent = background.label || `Base map ${index + 1}`;$('basemap-select').append(option); });
  $('basemap-row').hidden = backgrounds.length < 2;
  $('aerial-note').hidden = !backgrounds.some((background) => /aerial|ortho|satellite/i.test(background.label));
  $('basemap-select').addEventListener('change',() => { const background = backgrounds[Number($('basemap-select').value)];$('map-background').setAttribute('href',background.url); });
  if (data.overlay) { $('context-overlay').setAttribute('href',data.overlay);$('context-overlay').setAttribute('width',width);$('context-overlay').setAttribute('height',height); }
  else $('context-overlay').style.display = 'none';
  $('buildings-layer').replaceChildren(...(data.buildingPaths || []).map((entry) => path(typeof entry === 'string' ? entry : entry.path || entry.d)));
  $('context-layer').replaceChildren(...(data.contextPaths || []).map((entry) => path(typeof entry === 'string' ? entry : entry.path || entry.d,{fill:entry.fill || 'none',stroke:entry.stroke || '#869c94','stroke-width':entry.strokeWidth || '1','vector-effect':'non-scaling-stroke'})));
  [...new Map([...(data.sources || []),...(confidence?.sources || [])].filter((source) => source?.url).map((source) => [source.url,source])).values()].forEach((source) => {
    if (!source.url || !/^(?:https?:\/\/|\.\.?\/)/i.test(source.url)) return;
    const a = document.createElement('a');a.href = source.url;a.target = '_blank';a.rel = 'noopener noreferrer';a.textContent = `${source.label || source.url} ↗`;$('source-links').append(a);
  });
  const bands = data.depthLegend || [{color:'#b9dce9',label:'0'},{color:'#88bfd6',label:'0.5'},{color:'#5b9fbe',label:'1'},{color:'#327da2',label:'2'},{color:'#175676',label:'3+'}];
  bands.forEach((band) => {
    const swatch = document.createElement('i');swatch.style.background = band.color;swatch.title = band.label;$('legend-swatches').append(swatch);
    const label = document.createElement('span');
    const firstNumber = String(band.label).match(/\d+(?:\.\d+)?/);
    label.textContent = firstNumber ? `${Number(firstNumber[0])}${/[>+]/.test(band.label) ? '+' : ''}` : band.label;
    label.title = band.label;$('legend-labels').append(label);
  });
  const finiteValues = frames.map(valueOf).filter(Number.isFinite);
  const lo = Math.min(...finiteValues), hi = Math.max(...finiteValues);
  const points = frames.map((frame,index) => `${frames.length > 1 ? index / (frames.length - 1) * 1000 : 0},${36 - (valueOf(frame) - lo) / (hi - lo || 1) * 30}`);
  $('hydrograph-line').setAttribute('d',`M${points.join('L')}`);
  $('hydrograph-area').setAttribute('d',`M0,40L${points.join('L')}L1000,40Z`);
  $('time-slider').max = frames.length - 1;
  setText('start-label',literalTime(frames[0]).short);
  setText('end-label',literalTime(frames[frames.length - 1]).short);
  if (data.timelineNote) document.querySelector('.timeline-instruction').textContent = data.timelineNote;
  $('map-empty').hidden = true;

  document.querySelectorAll('[data-mode]').forEach((button) => { button.addEventListener('click',() => { mode = button.dataset.mode;drawFrame(requestedIndex,false); }); });
  $('time-slider').addEventListener('input',(event) => { stop();drawFrame(event.target.value); });
  $('play-button').addEventListener('click',togglePlayback);
  $('first-button').addEventListener('click',() => { stop();drawFrame(0); });
  $('previous-button').addEventListener('click',() => step(-1));
  $('next-button').addEventListener('click',() => step(1));
  $('peak-button').addEventListener('click',() => { stop();drawFrame(peak); });
  $('buildings-toggle').addEventListener('change',updateLayers);
  $('flood-buildings-toggle').addEventListener('change',updateLayers);
  $('fill-style-select').addEventListener('change',() => { waterStyle = $('fill-style-select').value;drawFrame(requestedIndex,false); });
  $('opacity-slider').addEventListener('input',updateLayers);
  $('confidence-select').addEventListener('change',() => { confidenceMetric = $('confidence-select').value;drawFrame(requestedIndex,false); });
  const divider = $('split-divider');
  const moveDivider = (screenX) => {
    const box = $('map-container').getBoundingClientRect();
    split = Math.max(0,Math.min(1,(screenX - box.left) / box.width));updateSplit();
  };
  divider.addEventListener('pointerdown',(event) => {
    if (event.button !== 0) return;
    event.preventDefault();event.stopPropagation();dividerPointer = event.pointerId;divider.setPointerCapture(event.pointerId);divider.focus();moveDivider(event.clientX);
  });
  divider.addEventListener('pointermove',(event) => {
    if (dividerPointer !== event.pointerId) return;
    event.preventDefault();event.stopPropagation();moveDivider(event.clientX);
  });
  const finishDivider = (event) => { if (dividerPointer === event.pointerId) dividerPointer = null; };
  ['pointerup','pointercancel','lostpointercapture'].forEach((name) => divider.addEventListener(name,finishDivider));
  divider.addEventListener('keydown',(event) => {
    const increment = event.shiftKey ? .1 : .02;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') split -= increment;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') split += increment;
    else if (event.key === 'Home') split = 0;
    else if (event.key === 'End') split = 1;
    else return;
    event.preventDefault();event.stopPropagation();split = Math.max(0,Math.min(1,split));updateSplit();
  });
  $('zoom-in').addEventListener('click',() => zoom(.75));
  $('zoom-out').addEventListener('click',() => zoom(1 / .75));
  $('reset-view').addEventListener('click',() => { viewport = {...initialView};updateViewport(); });
  $('print-button').addEventListener('click',() => { stop();window.print(); });
  svg.addEventListener('wheel',(event) => { event.preventDefault();zoom(Math.exp(Math.sign(event.deltaY) * .15),event.clientX,event.clientY); },{passive:false});
  svg.addEventListener('pointerdown',(event) => { if (event.button !== 0) return;pointer = {id:event.pointerId,x:event.clientX,y:event.clientY,view:{...viewport},scale:visibleExtent().scale};svg.setPointerCapture(event.pointerId);svg.classList.add('dragging'); });
  svg.addEventListener('pointermove',(event) => { if (!pointer || pointer.id !== event.pointerId) return;viewport.x = pointer.view.x - (event.clientX - pointer.x) / pointer.scale;viewport.y = pointer.view.y - (event.clientY - pointer.y) / pointer.scale;updateViewport(); });
  const endPointer = () => { pointer = null;svg.classList.remove('dragging'); };
  svg.addEventListener('pointerup',endPointer);svg.addEventListener('pointercancel',endPointer);svg.addEventListener('lostpointercapture',endPointer);
  document.addEventListener('keydown',(event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || /^(INPUT|SELECT|TEXTAREA|BUTTON|SUMMARY)$/.test(event.target.tagName) || event.target.isContentEditable) return;
    if (event.key === 'ArrowRight') { event.preventDefault();step(1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault();step(-1); }
    else if (event.key === 'Home') { event.preventDefault();stop();drawFrame(0); }
    else if (event.key === 'End') { event.preventDefault();stop();drawFrame(frames.length - 1); }
    else if (event.key === ' ') { event.preventDefault();togglePlayback(); }
    else if (event.target === svg && (event.key === '+' || event.key === '=')) { event.preventDefault();zoom(.75); }
    else if (event.target === svg && event.key === '-') { event.preventDefault();zoom(1 / .75); }
  });
  window.addEventListener('resize',updateViewport);
  window.addEventListener('beforeprint',() => { stop();updateViewport(); });
  window.addEventListener('afterprint',updateViewport);
  document.addEventListener('visibilitychange',() => { if (document.hidden) stop(); });
  const ready = drawFrame(current,false);
  window.FLOOD_VIEWER = Object.freeze({
    ready,
    showFrame:(index) => { stop();return drawFrame(index,false); },
    get state() { return {current,requestedIndex,sourceIndex:activeFrame?.sourceIndex,mode,waterStyle,opacity:Number($('opacity-slider').value),confidenceMetric,playing,split,highlightFloodTouchedBuildings:$('flood-buildings-toggle').checked,activeAreaHa:activeFrame?.activeAreaHa,strandedAreaHa:activeFrame?.strandedAreaHa,touchedBuildingCount:activeFrame?.touchedBuildingCount,rawTouchedBuildingCount:activeFrame?.rawTouchedBuildingCount,visibleTouchedBuildingCount:mode === 'split' ? {raw:activeFrame?.rawTouchedBuildingCount,refined:activeFrame?.touchedBuildingCount} : mode === 'raw' ? activeFrame?.rawTouchedBuildingCount : activeFrame?.touchedBuildingCount,detailCacheSize:detailCache.size}; }
  });
  updateViewport();
  // The hosted edition prints the selected map without shipping 193 static sheets.
  if (locationOptions.get('print') === '1') {
    ready.then(async () => {
      stop();
      if (!activeFrame) return;
      if (document.fonts?.ready) await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.print();
    }).catch(error => console.error('Could not prepare the print view.', error));
  }

})();
