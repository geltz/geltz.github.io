(function() {
    // --- DOM Elements ---
    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    
    // Sections
    const results = document.getElementById('results');
    const resultsTitle = document.getElementById('resultsTitle');
    
    const preview = document.getElementById('preview');
    const previewImg = document.getElementById('imagePreview');
    const previewName = document.getElementById('previewName');
    const previewSize = document.getElementById('previewSize');
    
    const sourceSection = document.getElementById('sourceSection');
    const sourceEl = document.getElementById('source');
    
    const positiveSection = document.getElementById('positiveSection');
    const positiveEl = document.getElementById('positivePrompt');
    
    const negativeSection = document.getElementById('negativeSection');
    const negativeEl = document.getElementById('negativePrompt');
    
    const settingsSection = document.getElementById('settingsSection');
    const settingsEl = document.getElementById('settings');

    // Buttons
    const copyAllBtn = document.getElementById('copyAllBtn');
    const exportJsonBtn = document.getElementById('exportJsonBtn');

    // State
    let currentParsedMeta = null;
    let currentFileName = "";
    let currentFileSize = 0;

    // --- Event Listeners ---

    dropZone.addEventListener('click', () => fileInput.click());
    
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        handleFile(e.dataTransfer.files[0]);
    });
    
    fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

    // --- Copy & Export ---

    copyAllBtn.addEventListener('click', async () => {
        if (!currentParsedMeta) return;
        // Format the JSON to be readable text
        const exportData = {
            filename: currentFileName,
            ...currentParsedMeta
        };
        const text = JSON.stringify(exportData, null, 2);
        await copyToClipboard(text, copyAllBtn);
    });

    document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const targetId = btn.dataset.target;
            const el = document.getElementById(targetId);
            if (!el) return;
            const text = el.textContent.trim();
            if (!text || text === '(not found)') return;
            await copyToClipboard(text, btn);
        });
    });

    async function copyToClipboard(text, btn) {
        try {
            await navigator.clipboard.writeText(text);
            showCopyFeedback(btn, 'Copied!');
        } catch (err) {
            // Fallback
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            showCopyFeedback(btn, 'Copied!');
        }
    }

    function showCopyFeedback(button, message) {
        const svg = button.querySelector('svg');
        if (svg) {
            const originalStroke = svg.style.stroke;
            svg.style.stroke = '#10b981'; // Green
            setTimeout(() => {
                svg.style.stroke = originalStroke;
            }, 1500);
        }
    }

    exportJsonBtn.addEventListener('click', () => {
        if (!currentParsedMeta) return;
        const blob = new Blob([JSON.stringify(currentParsedMeta, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = (currentFileName.replace(/\.[^.]+$/, '') || 'metadata') + '.json';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    });

    // --- Helper Functions ---

    function oneline(s) {
        return (s || "").split(/\s+/).join(" ").trim();
    }

    function formatSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        const kb = bytes / 1024;
        if (kb < 1024) return kb.toFixed(1) + ' KB';
        return (kb / 1024).toFixed(1) + ' MB';
    }

    // --- Parsers ---

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
        
        return { prompt: oneline(prompt), negative_prompt: oneline(negative), settings, source: "automatic1111" };
    }

    function parseComfyUI(workflow) {
        if (!workflow || typeof workflow !== "object") return null;
        
        let prompt = "";
        let negative = "";
        const settings = {};

        // Try to find KSampler
        const ksamplerKey = Object.keys(workflow).find(k => workflow[k].class_type === "KSampler" || workflow[k].class_type === "KSamplerAdvanced");
        
        if (ksamplerKey) {
            const node = workflow[ksamplerKey];
            const inp = node.inputs || {};
            
            if (inp.seed) settings.seed = inp.seed;
            if (inp.steps) settings.steps = inp.steps;
            if (inp.cfg) settings.cfg = inp.cfg;
            if (inp.sampler_name) settings.sampler = inp.sampler_name;
            if (inp.scheduler) settings.scheduler = inp.scheduler;

            // Helper to walk back inputs to find text
            const findText = (link) => {
                if(Array.isArray(link)) {
                    const prevNode = workflow[link[0]];
                    if(prevNode && prevNode.inputs && prevNode.inputs.text) return prevNode.inputs.text;
                    if(prevNode && prevNode.inputs && prevNode.inputs.text_g) return prevNode.inputs.text_g; // CLIP Text Encode SDXL
                }
                return "";
            };

            prompt = oneline(findText(inp.positive));
            negative = oneline(findText(inp.negative));
        }

        // Add other useful nodes to settings if not already found
        Object.values(workflow).forEach(node => {
            if (node.class_type === "CheckpointLoaderSimple" && node.inputs) {
                settings.model = node.inputs.ckpt_name;
            }
            if (node.class_type === "EmptyLatentImage" && node.inputs) {
                settings.size = `${node.inputs.width}x${node.inputs.height}`;
            }
        });

        return { prompt, negative_prompt: negative, settings, source: "comfyui" };
    }

    function parseGeneralJson(obj) {
        // Handle NovelAI, InvokeAI, SwarmUI wrapped as JSON
        
        // 1. SwarmUI
        if (obj.sui_image_params) {
            const p = obj.sui_image_params;
            const settings = {};
            for(const [k,v] of Object.entries(p)) {
                if(['prompt','negative_prompt','uc'].includes(k)) continue;
                if(k.startsWith('sui_')) continue;
                settings[k.toLowerCase()] = v;
            }
            return {
                prompt: oneline(p.prompt),
                negative_prompt: oneline(p.negative_prompt || p.uc),
                settings,
                source: "swarmui"
            };
        }

        // 2. InvokeAI
        if (obj.positive_prompt || obj.negative_prompt || obj.generation_mode) {
            const settings = {};
            for(const [k,v] of Object.entries(obj)) {
                if(['positive_prompt','negative_prompt','prompt'].includes(k)) continue;
                settings[k.toLowerCase()] = v;
            }
            return {
                prompt: oneline(obj.positive_prompt || obj.prompt),
                negative_prompt: oneline(obj.negative_prompt),
                settings,
                source: "invokeai"
            };
        }

        // 3. NovelAI
        if (obj.prompt && (obj.uc || obj.negative_prompt)) {
             const settings = {};
             for(const [k,v] of Object.entries(obj)) {
                 if(['prompt','uc','negative_prompt'].includes(k)) continue;
                 settings[k.toLowerCase()] = v;
             }
             return {
                 prompt: oneline(obj.prompt),
                 negative_prompt: oneline(obj.uc || obj.negative_prompt),
                 settings,
                 source: "novelai"
             };
        }

        return null;
    }

    function parseMetadata(meta) {
        const base = { prompt: "", negative_prompt: "", settings: {}, source: "unknown" };
        if (!meta || Object.keys(meta).length === 0) return base;

        // 1. Try A1111 "parameters" string
        if (typeof meta.parameters === "string") {
            // Sometimes parameters is actually JSON
            if(meta.parameters.trim().startsWith('{')) {
                try {
                    const j = JSON.parse(meta.parameters);
                    const res = parseGeneralJson(j);
                    if(res) return res;
                } catch(e) {}
            }
            return parseA1111String(meta.parameters);
        }

        // 2. Try ComfyUI (workflow / prompt)
        // Usually found in "prompt" or "workflow" keys containing JSON strings
        if (meta.prompt || meta.workflow) {
            try {
                const jsonStr = meta.prompt || meta.workflow;
                const jsonObj = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
                const res = parseComfyUI(jsonObj);
                if (res) return res;
            } catch(e) {}
        }

        // 3. Try General JSON fields (InvokeAI often stores metadata in 'invokeai_metadata' or similar)
        for (const key of Object.keys(meta)) {
            if (typeof meta[key] === 'string' && (meta[key].startsWith('{') || meta[key].startsWith('['))) {
                try {
                    const j = JSON.parse(meta[key]);
                    const res = parseGeneralJson(j);
                    if(res) return res;
                } catch(e) {}
            }
        }

        // 4. Fallback: Treat the top-level meta object as settings
        const settings = {};
        for (const [k, v] of Object.entries(meta)) {
            if (k === "prompt") base.prompt = v;
            else if (k === "negative_prompt") base.negative_prompt = v;
            else settings[k.toLowerCase()] = typeof v === 'object' ? JSON.stringify(v) : v;
        }
        
        return { ...base, settings };
    }

    // --- File Handling ---

    function handleFile(file) {
        if (!file) return;
        currentFileName = file.name;
        currentFileSize = file.size;
        
        const lname = file.name.toLowerCase();
        if (lname.endsWith('.safetensors')) {
            handleSafetensors(file);
        } else {
            handleImage(file);
        }
    }

    async function handleImage(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            previewImg.src = e.target.result;
            previewName.textContent = currentFileName;
            previewSize.textContent = formatSize(currentFileSize);
            
            // Enable Image Mode
            resultsTitle.textContent = 'Preview';
            preview.classList.remove('hidden');
            positiveSection.classList.remove('hidden');
            negativeSection.classList.remove('hidden');
            sourceSection.classList.remove('hidden');
        };
        reader.readAsDataURL(file);

        // Process Metadata
        try {
            const arrayBuffer = await file.arrayBuffer();
            const meta = extractPNGMetadata(new Uint8Array(arrayBuffer));
            const parsed = parseMetadata(meta);
            currentParsedMeta = parsed;
            displayMetadata(parsed);
        } catch (err) {
            console.error(err);
            displayMetadata({ settings: { error: "Could not read metadata" } });
        }
    }

    function handleSafetensors(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                // Parse header
                const view = new DataView(e.target.result);
                const headerLen = Number(view.getBigUint64(0, true));
                const jsonStr = new TextDecoder().decode(new Uint8Array(e.target.result, 8, headerLen));
                const header = JSON.parse(jsonStr);
                
                const meta = header.__metadata__ || header.metadata || {};
                const parsed = { 
                    prompt: "", 
                    negative_prompt: "", 
                    settings: meta, 
                    source: "safetensors_lora" 
                };
                
                currentParsedMeta = parsed;
                
                // Enable Lora Mode
                previewImg.src = ''; // No image
                previewName.textContent = currentFileName;
                previewSize.textContent = formatSize(currentFileSize);
                resultsTitle.textContent = 'Model Info';
                preview.classList.add('hidden');
                positiveSection.classList.add('hidden');
                negativeSection.classList.add('hidden');
                sourceSection.classList.remove('hidden');
                
                displayMetadata(parsed);
                
            } catch (err) {
                console.error(err);
                displayMetadata({ settings: { error: "Invalid Safetensors header" } });
            }
        };
        // Read first 1MB
        reader.readAsArrayBuffer(file.slice(0, 1024 * 1024));
    }

    // --- PNG Extraction (Simplified) ---
    function extractPNGMetadata(u8) {
        const meta = {};
        if (u8.length < 8) return meta;
        
        // Check PNG signature
        const sig = [137, 80, 78, 71, 13, 10, 26, 10];
        for (let i = 0; i < 8; i++) if (u8[i] !== sig[i]) return meta;

        let offset = 8;
        const decoder = new TextDecoder();

        while (offset < u8.length) {
            const len = (u8[offset] << 24) | (u8[offset+1] << 16) | (u8[offset+2] << 8) | u8[offset+3];
            const type = String.fromCharCode(u8[offset+4], u8[offset+5], u8[offset+6], u8[offset+7]);
            
            if (type === 'tEXt') {
                const data = u8.slice(offset + 8, offset + 8 + len);
                const str = decoder.decode(data);
                const split = str.indexOf('\0');
                if (split > -1) {
                    const k = str.slice(0, split);
                    const v = str.slice(split + 1);
                    meta[k] = v;
                }
            }
            // Only basic tEXt support for simplicity. A1111 uses tEXt parameters.
            
            offset += 12 + len; // len + 4(len) + 4(type) + 4(crc)
        }
        return meta;
    }

    // --- Display Logic ---

    function displayMetadata(data) {
        results.classList.remove('hidden');
        sourceEl.textContent = data.source || 'unknown';

        // 1. Positive Prompt
        if (data.prompt) {
            positiveSection.classList.remove('hidden');
            positiveEl.textContent = data.prompt;
        } else {
            // If image mode, keep section but empty, if lora mode it's already hidden
            if (!preview.classList.contains('hidden')) {
                positiveEl.textContent = "(not found)";
            }
        }

        // 2. Negative Prompt
        if (data.negative_prompt) {
            negativeSection.classList.remove('hidden');
            negativeEl.textContent = data.negative_prompt;
        } else {
            if (!preview.classList.contains('hidden')) {
                negativeEl.textContent = "(not found)";
            }
        }

        // 3. Settings Grid
        settingsEl.innerHTML = '';
        const settings = data.settings || {};
        
        // Sort keys alphabetically for "ordered" reading
        const keys = Object.keys(settings).sort();

        if (keys.length === 0) {
            settingsEl.innerHTML = '<div class="setting-item" style="grid-column: 1/-1; text-align:center; opacity:0.6;">No additional settings found</div>';
            return;
        }

        keys.forEach(key => {
            // Ensure key is lowercase as requested
            const lowerKey = key.toLowerCase();
            let val = settings[key];
            
            // Convert objects to string representation
            if (typeof val === 'object' && val !== null) {
                val = JSON.stringify(val);
            }

            const item = document.createElement('div');
            item.className = 'setting-item';
            
            // Create HTML structure matching CSS: Bold Key (lowercase), then Value
            item.innerHTML = `
                <div style="font-weight:700; margin-bottom:4px; color:var(--color-primary); text-transform:lowercase;">${lowerKey}</div>
                <div style="word-break: break-word; font-size:0.9em; opacity:0.9;">${val}</div>
            `;
            
            settingsEl.appendChild(item);
        });
    }

})();