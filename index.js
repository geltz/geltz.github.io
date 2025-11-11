(function() {
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const results = document.getElementById('results');
    const preview = document.getElementById('preview');
    const previewImg = document.getElementById('imagePreview');
    const previewName = document.getElementById('previewName');
    const previewSize = document.getElementById('previewSize');
    const copyAllBtn = document.getElementById('copyAllBtn');
    const exportJsonBtn = document.getElementById('exportJsonBtn');
    const resultsTitle = document.getElementById('resultsTitle');
    const positiveSection = document.getElementById('positiveSection');
    const negativeSection = document.getElementById('negativeSection');
    const settingsSection = document.getElementById('settingsSection');
    const sourceSection = document.getElementById('sourceSection');
    let currentParsedMeta = null;
    let currentFileName = "";
    let currentFileSize = 0;
    let currentMode = "image";

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        handleFile(e.dataTransfer.files[0]);
    });
    fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

    copyAllBtn.addEventListener('click', async () => {
        if (!currentParsedMeta) return;
        const text = JSON.stringify(currentParsedMeta, null, 2);
        
        try {
            // Try the modern clipboard API first
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                console.log('Copied to clipboard successfully!');
                return;
            }
            
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            
            const successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            
            if (successful) {
                console.log('Copied to clipboard using fallback!');
            } else {
                console.error('Failed to copy using fallback method');
                // Last resort - show the text to user
                alert('Copy failed. Here is the text:\n\n' + text);
            }
        } catch (err) {
            console.error('Failed to copy: ', err);
            // Last resort - show the text to user
            alert('Copy failed. Here is the text:\n\n' + text);
        }
    });

    // Individual copy buttons functionality
	const copyButtons = document.querySelectorAll('.copy-btn');
	copyButtons.forEach(btn => {
		btn.addEventListener('click', async () => {
			const targetId = btn.dataset.target;
			const el = document.getElementById(targetId);
			if (!el) return;

			const text = el.textContent.trim();
			if (!text || text === '(not found)') return;

			try {
				// Try modern clipboard API first
				if (navigator.clipboard && navigator.clipboard.writeText) {
					await navigator.clipboard.writeText(text);
					showCopyFeedback(btn, 'Copied!');
					return;
				}
				
				// Fallback for older browsers
				const textArea = document.createElement('textarea');
				textArea.value = text;
				textArea.style.position = 'fixed';
				textArea.style.left = '-999999px';
				textArea.style.top = '-999999px';
				document.body.appendChild(textArea);
				textArea.focus();
				textArea.select();
				
				const successful = document.execCommand('copy');
				document.body.removeChild(textArea);
				
				if (successful) {
					showCopyFeedback(btn, 'Copied!');
				} else {
					showCopyFeedback(btn, 'Failed - select text manually');
				}
			} catch (err) {
				console.error('Copy failed: ', err);
				showCopyFeedback(btn, 'Failed - select text manually');
			}
		});
	});

	// helper function for user feedback
	function showCopyFeedback(button, message) {
		const originalTitle = button.getAttribute('aria-label') || '';
		button.setAttribute('aria-label', message);
		
		// Visual feedback - temporary color change
		const svg = button.querySelector('svg');
		if (svg) {
			const originalColor = svg.style.stroke;
			svg.style.stroke = '#10b981'; // Green color for success
			
			setTimeout(() => {
				button.setAttribute('aria-label', originalTitle);
				svg.style.stroke = originalColor || '#3f6c9b';
			}, 2000);
		}
	}

    exportJsonBtn.addEventListener('click', () => {
        if (!currentParsedMeta) return;
        exportCurrentJson(currentParsedMeta);
    });

    function oneline(s) {
        return (s || "").split(/\s+/).join(" ").trim();
    }

    function parseA1111String(s) {
        const lines = s.trim().split(/\r?\n/);
        const prompt = lines[0] ? lines[0].trim() : "";
        let negative = "";
        let restLines = [];
        if (lines.length > 1 && lines[1].startsWith("Negative prompt:")) {
            negative = lines[1].split(":", 2)[1].trim();
            restLines = lines.slice(2);
        } else {
            restLines = lines.slice(1);
        }
        const settings = {};
        restLines.join("\n").split(",").forEach(chunk => {
            const idx = chunk.indexOf(":");
            if (idx !== -1) {
                const k = chunk.slice(0, idx).trim().toLowerCase();
                const v = oneline(chunk.slice(idx + 1));
                settings[k] = v;
            }
        });
        return {
            prompt: oneline(prompt),
            negative_prompt: oneline(negative),
            settings,
            source: "automatic1111",
            raw: s
        };
    }

    function parseComfyUIObject(workflow) {
        if (!workflow || typeof workflow !== "object") return {
            prompt: "",
            negative_prompt: "",
            settings: {},
            source: "comfyui"
        };
        let ksampler = null,
            ckpt = null,
            latent = null;
        for (const key of Object.keys(workflow)) {
            const node = workflow[key];
            const t = node && node.class_type;
            if (t === "KSampler") ksampler = node;
            else if (t === "CheckpointLoaderSimple") ckpt = node;
            else if (t === "EmptyLatentImage") latent = node;
        }
        if (!ksampler) return {
            prompt: "",
            negative_prompt: "",
            settings: {},
            source: "comfyui"
        };
        const inp = ksampler.inputs || {};
        const settings = {
            steps: inp.steps,
            "cfg scale": inp.cfg,
            sampler: inp.sampler_name,
            scheduler: inp.scheduler,
            seed: inp.seed
        };
        if (ckpt && ckpt.inputs) settings.model = ckpt.inputs.ckpt_name || "unknown";
        if (latent && latent.inputs && latent.inputs.width && latent.inputs.height) settings.size = `${latent.inputs.width}x${latent.inputs.height}`;

        function readTextRef(ref) {
            if (Array.isArray(ref) && ref.length) {
                const node = workflow[String(ref[0])] || {};
                return oneline(node.inputs && node.inputs.text ? node.inputs.text : "");
            }
            return "";
        }
        const result = {
            prompt: readTextRef(inp.positive),
            negative_prompt: readTextRef(inp.negative),
            settings: {},
            source: "comfyui"
        };
        for (const [k, v] of Object.entries(settings))
            if (v !== undefined && v !== null) result.settings[k.toLowerCase()] = oneline(String(v));
        return result;
    }

    function parseComfyUIString(s) {
        try {
            const obj = JSON.parse(s);
            return parseComfyUIObject(obj);
        } catch {
            return {
                prompt: "",
                negative_prompt: "",
                settings: {},
                source: "comfyui"
            };
        }
    }

    function parseInvokeAIMetadata(val) {
        let jd = null;
        if (typeof val === "string") {
            try {
                jd = JSON.parse(val);
            } catch {
                return null;
            }
        } else if (val && typeof val === "object") jd = val;
        if (!jd) return null;
        const prompt = jd.positive_prompt || jd.prompt || "";
        const negative_prompt = jd.negative_prompt || "";
        const settings = {};
        for (const [k, v] of Object.entries(jd)) {
            if (k === "positive_prompt" || k === "negative_prompt" || k === "prompt") continue;
            settings[k.toLowerCase()] = typeof v === "string" ? oneline(v) : JSON.stringify(v);
        }
        return {
            prompt: oneline(prompt),
            negative_prompt: oneline(negative_prompt),
            settings,
            source: "invokeai",
            raw: typeof val === "string" ? val : JSON.stringify(val)
        };
    }

    function parseJsonLike(objOrStr) {
        let obj = objOrStr;

        // turn JSON-ish strings into objects
        if (typeof obj === "string") {
            try {
                obj = JSON.parse(obj);
            } catch {
                return null;
            }
        }

        if (!obj || typeof obj !== "object") return null;

        // 1) ComfyUI (graph-style)
        if (Object.values(obj).some(v => v && typeof v === "object" && "class_type" in v)) {
            const d = parseComfyUIObject(obj);
            d.source = "comfyui";
            return d;
        }

        // 2) SwarmUI (sometimes sent as plain object)
        if (obj.sui_image_params && typeof obj.sui_image_params === "object") {
            const p = obj.sui_image_params;
            const settings = {};

            for (const [k, v] of Object.entries(p)) {
                if (k === "prompt" || k === "negative_prompt" || k === "uc") continue;
                if (k.startsWith("sui_")) continue;
                settings[k.toLowerCase()] = typeof v === "string" ? oneline(v) : JSON.stringify(v);
            }

            return {
                prompt: oneline(String(p.prompt || "")),
                negative_prompt: oneline(String(p.negative_prompt || p.uc || "")),
                settings,
                source: "swarmui"
            };
        }

        // 3) NovelAI JSON inside Comment
        if (obj.Comment && typeof obj.Comment === "object") {
            const inner = parseJsonLike(obj.Comment);
            if (inner) {
                if (!inner.source) inner.source = "novelai";
                return inner;
            }
        }
        if (typeof obj.Comment === "string") {
            const inner = parseJsonLike(obj.Comment);
            if (inner) {
                inner.source = inner.source || "novelai";
                return inner;
            }
        }

        // helper for NAI-style settings
        const normalizeSetting = v => {
          if (typeof v === "string") return oneline(v);
          if (Array.isArray(v)) return v.map(x => String(x)).join(", ");
          if (v && typeof v === "object") {
            // return as-is for later expansion
            return v;
          }
          return String(v ?? "");
        };

        // 4) NovelAI / NAI-like JSON
        const looksLikeNAI =
            ("prompt" in obj && ("uc" in obj || "negative_prompt" in obj)) ||
            ("sampler" in obj && "seed" in obj && "strength" in obj);

        if (looksLikeNAI) {
            const toFlat = val => {
                if (typeof val === "string") return val;
                if (Array.isArray(val)) return val.map(String).join(", ");
                if (val && typeof val === "object") {
                    return Object.entries(val).map(([k, v]) => `${k}: ${String(v)}`).join(", ");
                }
                return "";
            };

            const settings = {};
            for (const [k, v] of Object.entries(obj)) {
                if (k === "prompt" || k === "uc" || k === "negative_prompt") continue;
                if (
                    k === "reference_image_multiple" ||
                    k === "reference_information_extracted_multiple" ||
                    k === "reference_strength_multiple"
                ) {
                    continue;
                }
                
                if (k === "v4_prompt" || k === "v4_negative_prompt") {
                    console.log('DEBUG:', k, v, typeof v);
                    if (v && typeof v === "object") {
                        settings[k.toLowerCase()] = v;
                    }
                    continue;
                }
                
                if (k === "extra_passthrough_testing") {
                    settings[k.toLowerCase()] = String(!!v);
                    continue;
                }
                
                if (typeof v === "string") {
                    settings[k.toLowerCase()] = oneline(v);
                } else if (Array.isArray(v)) {
                    settings[k.toLowerCase()] = v.map(x => String(x)).join(", ");
                } else if (v && typeof v === "object") {
                    // Keep objects intact instead of flattening
                    settings[k.toLowerCase()] = v;
                } else {
                    settings[k.toLowerCase()] = String(v ?? "");
                }
            }

            return {
                prompt: oneline(toFlat(obj.prompt)),
                negative_prompt: oneline(toFlat(obj.uc || obj.negative_prompt || "")),
                settings,
                source: "novelai"
            };
        }

        // 5) InvokeAI-ish JSON
        if ("generation_mode" in obj || "_invokeai_metadata_tag" in obj) {
            const settings = {};
            for (const [k, v] of Object.entries(obj)) {
                if (k === "positive_prompt" || k === "negative_prompt" || k === "prompt") continue;
                settings[k.toLowerCase()] = normalizeSetting(v);
            }
            return {
                prompt: oneline(obj.positive_prompt || obj.prompt || ""),
                negative_prompt: oneline(obj.negative_prompt || ""),
                settings,
                source: "invokeai"
            };
        }

        return null;
    }

    function parseMetadata(meta) {
        const base = {
            prompt: "",
            negative_prompt: "",
            settings: {},
            source: "unknown"
        };

        if (!meta || typeof meta !== "object") {
            return base;
        }

        // 0) explicit SwarmUI at top level
        if (meta.sui_image_params && typeof meta.sui_image_params === "object") {
            const j = parseJsonLike({
                sui_image_params: meta.sui_image_params
            });
            if (j) return j;
        }

        // 1) A1111 field, but check JSON first
        if (typeof meta.parameters === "string") {
            const raw = meta.parameters.trim();

            if (raw.startsWith("{") || raw.startsWith("[")) {
                const j = parseJsonLike(raw);
                if (j) return j;
            }

            const d = parseA1111String(meta.parameters);
            d.source = "automatic1111";
            return d;
        }

        // 2) prompt as string – try JSON first
        if (typeof meta.prompt === "string") {
            const s = meta.prompt.trim();
            if (s.startsWith("{") || s.startsWith("[")) {
                const j = parseJsonLike(s);
                if (j) return j;
            }
            return {
                prompt: oneline(s),
                negative_prompt: "",
                settings: {},
                source: "prompt"
            };
        }

        // 3) prompt as object
        if (meta.prompt && typeof meta.prompt === "object") {
            const j = parseJsonLike(meta.prompt);
            if (j) return j;
        }

        // 4) Comment – try JSON first, then A1111-ish
        if (typeof meta.Comment === "string") {
            const c = meta.Comment.trim();
            if (c.startsWith("{") || c.startsWith("[")) {
                const j = parseJsonLike(c);
                if (j) return j;
            }
            if (c.toLowerCase().includes("negative prompt:")) {
                const d = parseA1111String(c);
                d.source = "comment";
                return d;
            }
        } else if (meta.Comment && typeof meta.Comment === "object") {
            const j = parseJsonLike(meta.Comment);
            if (j) return j;
        }

        // 5) invokeai
        if (typeof meta.invokeai_metadata === "string") {
            const j = parseJsonLike(meta.invokeai_metadata);
            if (j) return j;
        }

        // 6) fallback
        const settings = Object.fromEntries(
            Object.entries(meta).map(([k, v]) => [
                k.toLowerCase(),
                typeof v === "string" ? oneline(v) : JSON.stringify(v)
            ])
        );

        return {
            ...base,
            settings
        };
    }

    async function extractPNGMetadata(blob) {
        const buf = await blob.arrayBuffer();
        const u8 = new Uint8Array(buf);
        if (u8.length < 8 || ![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A].every((b, i) => u8[i] === b)) return {};
        const meta = {};
        let offset = 8;
        async function maybeDecompress(deflated) {
            if (typeof DecompressionStream !== "undefined") {
                const ds = new DecompressionStream("deflate");
                const s = new Blob([deflated]).stream().pipeThrough(ds);
                const ab = await new Response(s).arrayBuffer();
                return new TextDecoder().decode(new Uint8Array(ab));
            }
            return new TextDecoder().decode(deflated);
        }
        while (offset + 8 <= u8.length) {
            const length = (u8[offset] << 24) | (u8[offset + 1] << 16) | (u8[offset + 2] << 8) | u8[offset + 3];
            const type = String.fromCharCode(u8[offset + 4], u8[offset + 5], u8[offset + 6], u8[offset + 7]);
            const dataStart = offset + 8;
            const dataEnd = dataStart + length;
            const data = u8.slice(dataStart, dataEnd);
            if (type === "tEXt") {
                const str = new TextDecoder().decode(data);
                const nul = str.indexOf("\0");
                if (nul > 0) {
                    const k = str.slice(0, nul);
                    const v = str.slice(nul + 1);
                    meta[k] = v;
                }
            } else if (type === "iTXt") {
                let p = 0;
                const readNull = () => {
                    const start = p;
                    while (p < data.length && data[p] !== 0) p++;
                    const out = new TextDecoder().decode(data.slice(start, p));
                    p++;
                    return out;
                };
                const keyword = readNull();
                const compressionFlag = data[p++];
                p++;
                const lang = readNull();
                const trans = readNull();
                const textBytes = data.slice(p);
                if (compressionFlag === 1) {
                    try {
                        meta[keyword] = await maybeDecompress(textBytes);
                    } catch {
                        meta[keyword] = new TextDecoder().decode(textBytes);
                    }
                } else {
                    meta[keyword] = new TextDecoder().decode(textBytes);
                }
            } else if (type === "zTXt") {
                const nul = data.indexOf(0);
                if (nul > 0) {
                    const keyword = new TextDecoder().decode(data.slice(0, nul));
                    const compressed = data.slice(nul + 2);
                    try {
                        meta[keyword] = await maybeDecompress(compressed);
                    } catch {
                        meta[keyword] = "";
                    }
                }
            }
            offset = dataEnd + 4;
        }
        return meta;
    }

    function displayImageMetadata(data) {
        document.getElementById('source').textContent = data.source || 'unknown';
        document.getElementById('positivePrompt').textContent = data.prompt || '(not found)';
        document.getElementById('negativePrompt').textContent = data.negative_prompt || '(not found)';
        const settingsDiv = document.getElementById('settings');
        settingsDiv.innerHTML = '';
        const settings = data.settings || {};
        const keys = Object.keys(settings);
        if (keys.length) {
            keys.forEach(k => {
                const keyEl = document.createElement('div');
                keyEl.className = 'settings-key';
                keyEl.textContent = k + ':';
                const valEl = document.createElement('div');
                valEl.className = 'settings-value';
                const v = settings[k];
                if (typeof v === 'string') {
                    valEl.textContent = v;
                } else if (v && typeof v === 'object' && 'caption' in v) {
                    // Handle nested caption object
                    const cap = v.caption;
                    if (cap && typeof cap === 'object' && 'base_caption' in cap) {
                        valEl.textContent = cap.base_caption;
                    } else if (typeof cap === 'string') {
                        valEl.textContent = cap;
                    } else {
                        valEl.textContent = JSON.stringify(v);
                    }
                } else {
                    valEl.textContent = JSON.stringify(v);
                }
                settingsDiv.appendChild(keyEl);
                settingsDiv.appendChild(valEl);
            });
        } else {
            const note = document.createElement('div');
            note.className = 'settings-value';
            note.textContent = '(not found)';
            settingsDiv.appendChild(note);
        }
        results.classList.remove('hidden');
    }

    function setModeImage() {
        currentMode = 'image';
        resultsTitle.textContent = 'image';
        preview.classList.remove('hidden');
        positiveSection.classList.remove('hidden');
        negativeSection.classList.remove('hidden');
        settingsSection.classList.remove('hidden');
        sourceSection.classList.remove('hidden');
    }

    function setModeLora() {
        currentMode = 'lora';
        resultsTitle.textContent = 'lora';
        preview.classList.add('hidden');
        positiveSection.classList.add('hidden');
        negativeSection.classList.add('hidden');
        settingsSection.classList.remove('hidden'); // ← Changed to remove('hidden')
        sourceSection.classList.add('hidden');
    }

    function handleFile(file) {
        if (!file) return;
        currentFileName = file.name || "";
        currentFileSize = file.size || 0;
        const lname = currentFileName.toLowerCase();
        if (lname.endsWith('.safetensors')) handleSafetensors(file);
        else handleImage(file);
    }

    function handleImage(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            previewImg.src = e.target.result;
            previewName.textContent = currentFileName;
            previewSize.textContent = currentFileSize ? formatSize(currentFileSize) : '';
            setModeImage();
            (async () => {
                const blob = await (await fetch(e.target.result)).blob();
                const meta = await extractPNGMetadata(blob);
                const parsed = parseMetadata(meta);
                currentParsedMeta = parsed;
                displayImageMetadata(parsed);
            })();
        };
        reader.readAsDataURL(file);
    }

    function handleSafetensors(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const buffer = e.target.result;
                const headerObj = parseSafetensorsHeader(buffer);
                const loraMeta = extractLoraMetadata(headerObj);
                const wrapped = {
                    metadata: loraMeta
                };
                currentParsedMeta = wrapped;
                displayLoraMetadata(wrapped);
            } catch (err) {
                currentParsedMeta = {
                    metadata: {
                        error: String(err)
                    }
                };
                displayLoraMetadata(currentParsedMeta);
            }
        };
        reader.readAsArrayBuffer(file);
    }

    function parseSafetensorsHeader(arrayBuffer) {
        if (arrayBuffer.byteLength < 8) throw new Error('Invalid safetensors file');
        const view = new DataView(arrayBuffer, 0, 8);
        const headerLen = Number(view.getBigUint64(0, true));
        const headerStart = 8;
        const headerEnd = headerStart + headerLen;
        if (arrayBuffer.byteLength < headerEnd) throw new Error('Truncated metadata header');
        const headerBytes = new Uint8Array(arrayBuffer.slice(headerStart, headerEnd));
        const jsonText = new TextDecoder().decode(headerBytes);
        return JSON.parse(jsonText);
    }

    function extractLoraMetadata(meta) {
        if (meta && typeof meta === 'object') {
            if (meta.__metadata__ && typeof meta.__metadata__ === 'object') return meta.__metadata__;
            if (meta.metadata && typeof meta.metadata === 'object') return meta.metadata;
            const filtered = {};
            for (const [k, v] of Object.entries(meta)) {
                if (!(v && typeof v === 'object' && 'dtype' in v && 'shape' in v)) filtered[k] = v;
            }
            return filtered;
        }
        return {};
    }

    function displayLoraMetadata(data) {
        setModeLora();
        document.getElementById('source').textContent = 'safetensors';
        
        const settingsDiv = document.getElementById('settings');
        settingsDiv.innerHTML = '';
        
        const meta = data.metadata || {};
        const entries = Object.entries(meta);
        
        if (entries.length) {
            entries.forEach(([key, val]) => {
                const keyEl = document.createElement('div');
                keyEl.className = 'settings-key';
                keyEl.textContent = key + ':';
                const valEl = document.createElement('div');
                valEl.className = 'settings-value';
                valEl.textContent = Array.isArray(val) ? val.join(', ') : String(val);
                settingsDiv.appendChild(keyEl);
                settingsDiv.appendChild(valEl);
            });
        } else {
            const note = document.createElement('div');
            note.className = 'settings-value';
            note.textContent = '(no metadata)';
            settingsDiv.appendChild(note);
        }
        
        results.classList.remove('hidden');
    }

    function exportCurrentJson(obj) {
        const blob = new Blob([JSON.stringify(obj, null, 2)], {
            type: 'application/json'
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const baseName = currentFileName ? currentFileName.replace(/\.[^.]+$/, '') : 'metadata';
        a.download = baseName + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        const kb = bytes / 1024;
        if (kb < 1024) return kb.toFixed(1) + ' KB';
        const mb = kb / 1024;
        return mb.toFixed(1) + ' MB';
    }

})();
