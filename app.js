/**
 * 智能语音购车助手 - 核心应用
 * 功能：录音、音波可视化、语音转文字、千问API信息提取
 */

class VoiceCarAssistant {
    constructor() {
        this.isRecording = false;
        this.audioContext = null;
        this.analyser = null;
        this.mediaStream = null;
        this.animationId = null;
        this.recognition = null;
        this.transcriptBuffer = '';
        this.analysisTimeout = null;
        this.lastAnalysisTime = 0;
        
        // 千问API实例
        this.qwenAPI = null;
        
        // DOM元素
        this.canvas = document.getElementById('waveCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.controlBtn = document.getElementById('controlBtn');
        this.btnLabel = document.getElementById('btnLabel');
        this.statusText = document.getElementById('statusText');
        this.pulseRing = document.getElementById('pulseRing');
        this.infoCard = document.querySelector('.info-card');
        this.typingIndicator = document.getElementById('typingIndicator');
        this.toast = document.getElementById('toast');
        
        // 信息展示元素
        this.infoElements = {
            carPrice: document.getElementById('carPrice'),
            downPayment: document.getElementById('downPayment'),
            monthlyPayment: document.getElementById('monthlyPayment'),
            loanTerm: document.getElementById('loanTerm')
        };
        
        // 信息项容器（用于高亮效果）
        this.infoItems = {
            carPrice: document.getElementById('priceItem'),
            downPayment: document.getElementById('downPaymentItem'),
            monthlyPayment: document.getElementById('monthlyItem'),
            loanTerm: document.getElementById('termItem')
        };
        
        // 转录区域元素
        this.transcriptSection = document.getElementById('transcriptSection');
        this.transcriptContent = document.getElementById('transcriptContent');
        
        // 转录内容存储
        this.finalTranscript = '';
        this.interimTranscript = '';
        
        // 音量显示元素
        this.volumeDisplay = document.getElementById('volumeDisplay');
        this.volumeBar = document.getElementById('volumeBar');
        this.volumeValue = document.getElementById('volumeValue');
        
        this.init();
    }
    
    init() {
        this.setupCanvas();
        this.bindEvents();
        this.initSpeechRecognition();
        this.initQwenAPI();
        this.checkEnvironment();
        this.drawIdleWave();
        
        // 启动空闲波形动画
        this.startIdleAnimation();
    }
    
    // 检查运行环境
    checkEnvironment() {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
        const isHttps = location.protocol === 'https:';
        const isLocalhost = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
        
        // iOS Safari 且非 HTTPS 环境下显示提示
        if ((isIOS || isSafari) && !isHttps && !isLocalhost) {
            const banner = document.getElementById('httpsBanner');
            if (banner) {
                banner.classList.add('show');
            }
            console.warn('iOS Safari requires HTTPS for microphone access');
        }
    }
    
    // 设置Canvas尺寸
    setupCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = this.canvas.getBoundingClientRect();
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.scale(dpr, dpr);
        this.canvasWidth = rect.width;
        this.canvasHeight = rect.height;
        
        window.addEventListener('resize', () => {
            const rect = this.canvas.getBoundingClientRect();
            this.canvas.width = rect.width * dpr;
            this.canvas.height = rect.height * dpr;
            this.ctx.scale(dpr, dpr);
            this.canvasWidth = rect.width;
            this.canvasHeight = rect.height;
        });
    }
    
    // 绑定事件
    bindEvents() {
        this.controlBtn.addEventListener('click', () => this.toggleRecording());
    }
    
    // 初始化千问API
    initQwenAPI() {
        // 从localStorage读取API Key
        const apiKey = localStorage.getItem('qwen_api_key');
        if (apiKey && typeof QwenAPI !== 'undefined') {
            this.qwenAPI = new QwenAPI(apiKey);
        }
    }
    
    // 设置千问API Key
    setQwenAPIKey(apiKey) {
        if (apiKey && typeof QwenAPI !== 'undefined') {
            this.qwenAPI = new QwenAPI(apiKey);
            localStorage.setItem('qwen_api_key', apiKey);
            return true;
        }
        return false;
    }
    
    // 初始化语音识别
    initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.showToast('您的浏览器不支持语音识别功能');
            return;
        }
        
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'zh-CN';
        
        this.recognition.onresult = (event) => {
            let interimTranscript = '';
            let finalTranscript = '';
            
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }
            
            // 更新转录内容
            if (finalTranscript) {
                this.finalTranscript += finalTranscript;
                this.transcriptBuffer += finalTranscript;
                this.debouncedAnalyze(this.transcriptBuffer);
            }
            
            this.interimTranscript = interimTranscript;
            
            // 实时更新转录显示
            this.updateTranscriptDisplay();
        };
        
        this.recognition.onerror = (event) => {
            console.error('语音识别错误:', event.error);
            if (event.error === 'no-speech' || event.error === 'audio-capture') return;
            if (event.error === 'not-allowed') {
                this.showToast('请允许麦克风权限以使用语音功能');
            } else {
                this.showToast('语音识别出错，请重试');
            }
        };
        
        this.recognition.onend = () => {
            // 如果仍在录音状态，自动重启识别
            if (this.isRecording) {
                try {
                    this.recognition.start();
                } catch (e) {
                    console.warn('语音识别重启失败');
                }
            }
        };
    }
    
    // 防抖分析
    debouncedAnalyze(text) {
        const now = Date.now();
        this.lastAnalysisTime = now;
        
        // 清除之前的定时器
        if (this.analysisTimeout) {
            clearTimeout(this.analysisTimeout);
        }
        
        // 显示分析中状态
        this.typingIndicator.classList.add('active');
        
        // 延迟分析，等待用户说完
        this.analysisTimeout = setTimeout(() => {
            if (now === this.lastAnalysisTime) {
                this.analyzeText(text);
            }
        }, 1500);
    }
    
    // 更新转录显示
    updateTranscriptDisplay() {
        console.log('[VoiceAssistant] updateTranscriptDisplay called', {
            transcriptContent: !!this.transcriptContent,
            finalTranscript: this.finalTranscript,
            interimTranscript: this.interimTranscript,
            isRecording: this.isRecording
        });
        
        if (!this.transcriptContent) {
            console.warn('[VoiceAssistant] transcriptContent is null!');
            return;
        }
        
        let html = '';
        
        // 显示最终转录结果
        if (this.finalTranscript) {
            html += `<span class="transcript-final">${this.escapeHtml(this.finalTranscript)}</span>`;
        }
        
        // 显示临时转录结果（带光标）
        if (this.interimTranscript) {
            if (this.finalTranscript) {
                html += ' ';
            }
            html += `<span class="transcript-interim">${this.escapeHtml(this.interimTranscript)}<span class="transcript-cursor"></span></span>`;
        } else if (this.isRecording) {
            // 正在录音但没有临时内容时，显示闪烁光标
            html += '<span class="transcript-cursor"></span>';
        }
        
        const finalHtml = html || '<span class="transcript-placeholder">正在聆听，请开始说话...</span>';
        this.transcriptContent.innerHTML = finalHtml;
        console.log('[VoiceAssistant] transcriptContent updated:', finalHtml.substring(0, 100));
        
        // 自动滚动到底部
        this.transcriptContent.scrollTop = this.transcriptContent.scrollHeight;
    }
    
    // HTML转义，防止XSS
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // 检查是否为安全上下文（HTTPS或localhost）
    isSecureContext() {
        return window.isSecureContext || 
               location.hostname === 'localhost' || 
               location.hostname === '127.0.0.1';
    }
    
    // 切换录音状态
    async toggleRecording() {
        if (this.isRecording) {
            this.stopRecording();
        } else {
            await this.startRecording();
        }
    }
    
    // 开始录音
    async startRecording() {
        // 检查安全上下文
        if (!this.isSecureContext()) {
            this.showToast('iOS Safari 需要使用 HTTPS 才能录音', 5000);
            this.showHttpsHelp();
            return;
        }
        
        // iOS Safari 需要在用户手势中立即请求权限
        // 先更新UI状态表示正在请求权限
        this.statusText.textContent = '请求权限...';
        
        try {
            // iOS Safari 需要更简单的约束
            const constraints = {
                audio: {
                    echoCancellation: { ideal: true },
                    noiseSuppression: { ideal: true },
                    autoGainControl: { ideal: true }
                }
            };
            
            // 请求麦克风权限
            this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            // iOS 需要创建音频上下文（必须在用户手势中）
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();
            
            // iOS 需要恢复音频上下文
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.analyser.smoothingTimeConstant = 0.85;
            
            const source = this.audioContext.createMediaStreamSource(this.mediaStream);
            source.connect(this.analyser);
            
            // 延迟启动语音识别，确保音频系统已就绪
            setTimeout(() => {
                if (this.recognition && this.isRecording) {
                    try {
                        this.finalTranscript = '';
                        this.interimTranscript = '';
                        this.recognition.start();
                    } catch (e) {
                        console.warn('语音识别启动失败:', e);
                    }
                }
            }, 100);
            
            // 更新UI状态
            this.isRecording = true;
            this.controlBtn.classList.add('recording');
            this.statusText.classList.add('recording');
            this.pulseRing.classList.add('active');
            this.transcriptSection.classList.add('show');
            this.infoCard.classList.add('show');
            this.volumeDisplay.classList.add('show');
            this.statusText.textContent = '正在聆听...';
            this.btnLabel.textContent = '点击暂停';
            
            // 清空之前的转录内容
            this.finalTranscript = '';
            this.interimTranscript = '';
            this.updateTranscriptDisplay();
            
            // 重置音量显示
            this.updateVolumeDisplay(0);
            
            // 停止空闲动画，开始录音动画
            this.stopIdleAnimation();
            this.animateWave();
            
            this.showToast('已开始录音，请说出您的购车需求');
            
        } catch (error) {
            console.error('启动录音失败:', error);
            this.handleRecordingError(error);
        }
    }
    
    // 处理录音错误
    handleRecordingError(error) {
        let message = '启动录音失败';
        let duration = 3000;
        
        switch (error.name) {
            case 'NotAllowedError':
            case 'PermissionDeniedError':
                message = '请允许麦克风权限：设置 > Safari > 麦克风 > 允许';
                duration = 5000;
                this.showPermissionHelp();
                break;
            case 'NotFoundError':
            case 'DevicesNotFoundError':
                message = '未找到麦克风设备';
                break;
            case 'NotReadableError':
            case 'TrackStartError':
                message = '麦克风被其他应用占用';
                break;
            case 'SecurityError':
                message = '请在 HTTPS 环境下使用';
                duration = 5000;
                this.showHttpsHelp();
                break;
            case 'AbortError':
                // 用户取消，不显示错误
                this.statusText.textContent = '准备就绪';
                return;
            default:
                message = `录音错误: ${error.message || error.name || '未知错误'}`;
        }
        
        this.statusText.textContent = '启动失败';
        this.showToast(message, duration);
    }
    
    // 显示权限帮助
    showPermissionHelp() {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        if (isIOS) {
            setTimeout(() => {
                alert('iOS 权限设置帮助：\n\n1. 打开 iPhone "设置"\n2. 找到 "Safari"\n3. 点击 "麦克风"\n4. 选择 "允许"\n\n然后刷新页面重试。');
            }, 500);
        }
    }
    
    // 显示HTTPS帮助
    showHttpsHelp() {
        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
        if (isIOS) {
            setTimeout(() => {
                alert('iOS Safari 录音需要使用 HTTPS 安全连接。\n\n解决方案：\n\n1. 使用 ngrok 等工具创建 HTTPS 隧道\n2. 部署到支持 HTTPS 的服务器\n3. 使用 localhost 在电脑上测试');
            }, 500);
        }
    }
    
    // 停止录音
    stopRecording() {
        this.isRecording = false;
        
        // 停止语音识别
        if (this.recognition) {
            try {
                this.recognition.stop();
            } catch (e) {}
        }
        
        // 停止音频流
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
        
        // 关闭音频上下文
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
        }
        
        // 停止动画
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        
        // 更新UI状态
        this.controlBtn.classList.remove('recording');
        this.statusText.classList.remove('recording');
        this.pulseRing.classList.remove('active');
        this.typingIndicator.classList.remove('active');
        this.volumeDisplay.classList.remove('show');
        this.statusText.textContent = '已暂停';
        this.btnLabel.textContent = '点击继续';
        
        // 清空临时转录，保留最终结果
        this.interimTranscript = '';
        this.updateTranscriptDisplay();
        
        // 重置音量显示
        this.updateVolumeDisplay(0);
        
        // 显示静态音波
        this.startIdleAnimation();
        
        this.showToast('录音已暂停');
    }
    
    // 启动空闲动画
    startIdleAnimation() {
        if (this.idleAnimationId) return;
        
        const animate = () => {
            this.drawIdleWave();
            this.idleAnimationId = requestAnimationFrame(animate);
        };
        animate();
    }
    
    // 停止空闲动画
    stopIdleAnimation() {
        if (this.idleAnimationId) {
            cancelAnimationFrame(this.idleAnimationId);
            this.idleAnimationId = null;
        }
    }
    
    // 音波动画
    animateWave() {
        const bufferLength = this.analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        
        const draw = () => {
            if (!this.isRecording) return;
            
            this.animationId = requestAnimationFrame(draw);
            this.analyser.getByteFrequencyData(dataArray);
            
            // 计算平均音量（使用更宽的频率范围获得更好的效果）
            let sum = 0;
            let peak = 0;
            // 主要使用低频和中频部分（人声范围）
            const usefulLength = Math.floor(bufferLength * 0.6);
            for (let i = 0; i < usefulLength; i++) {
                sum += dataArray[i];
                if (dataArray[i] > peak) peak = dataArray[i];
            }
            const average = sum / usefulLength;
            
            // 结合平均值和峰值获得更自然的音量表现
            const normalizedVolume = Math.min((average * 0.7 + peak * 0.3) / 128, 1);
            
            // 更新音量显示
            this.updateVolumeDisplay(normalizedVolume);
            
            this.drawWave(dataArray, normalizedVolume);
        };
        
        draw();
    }
    
    // 更新音量显示
    updateVolumeDisplay(volume) {
        if (!this.volumeBar || !this.volumeValue) return;
        
        // 将音量转换为百分比（0-100）
        const percentage = Math.round(volume * 100);
        
        // 更新音量条高度
        this.volumeBar.style.height = `${percentage}%`;
        
        // 更新音量数值
        this.volumeValue.textContent = `${percentage}%`;
        
        // 根据音量级别改变颜色
        if (percentage >= 80) {
            this.volumeBar.classList.add('high');
            this.volumeValue.style.color = '#ff4444';
        } else if (percentage >= 50) {
            this.volumeBar.classList.remove('high');
            this.volumeValue.style.color = '#ffaa00';
        } else {
            this.volumeBar.classList.remove('high');
            this.volumeValue.style.color = '#00d4ff';
        }
    }
    
    // 绘制音波
    drawWave(dataArray, volume) {
        const ctx = this.ctx;
        const width = this.canvasWidth;
        const height = this.canvasHeight;
        const centerY = height / 2;
        const centerX = width / 2;
        
        ctx.clearRect(0, 0, width, height);
        
        // 绘制多层波形
        const layers = [
            { color: 'rgba(0, 212, 255, 0.2)', amplitude: 1.0, speed: 1, offset: 0 },
            { color: 'rgba(112, 0, 255, 0.3)', amplitude: 0.8, speed: 1.3, offset: 2 },
            { color: 'rgba(0, 212, 255, 0.5)', amplitude: 0.6, speed: 0.8, offset: 4 }
        ];
        
        const time = Date.now() * 0.002;
        
        layers.forEach((layer, layerIndex) => {
            ctx.beginPath();
            ctx.strokeStyle = layer.color;
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            
            const points = 150;
            const barWidth = width / points;
            
            for (let i = 0; i < points; i++) {
                const x = i * barWidth;
                
                // 获取频率数据并平滑处理
                const dataIndex = Math.floor((i / points) * (dataArray.length * 0.6));
                const frequency = dataArray[dataIndex] || 0;
                
                // 计算波形高度
                const normalizedFreq = frequency / 255;
                const waveHeight = normalizedFreq * layer.amplitude * volume * (height * 0.4);
                
                // 添加波浪效果
                const waveOffset = Math.sin(i * 0.05 + time * layer.speed + layer.offset) * 10;
                
                // 距离中心的距离影响（中间高两边低）
                const distanceFromCenter = Math.abs(i - points / 2) / (points / 2);
                const centerMultiplier = 1 - distanceFromCenter * 0.5;
                
                const finalHeight = waveHeight * centerMultiplier + waveOffset;
                
                if (i === 0) {
                    ctx.moveTo(x, centerY - finalHeight);
                } else {
                    const prevX = (i - 1) * barWidth;
                    const prevIndex = Math.floor(((i - 1) / points) * (dataArray.length * 0.6));
                    const prevFreq = dataArray[prevIndex] || 0;
                    const prevHeight = (prevFreq / 255) * layer.amplitude * volume * (height * 0.4) * centerMultiplier;
                    
                    const cpX = (prevX + x) / 2;
                    ctx.quadraticCurveTo(prevX, centerY - prevHeight, cpX, centerY - (finalHeight + prevHeight) / 2);
                }
            }
            
            ctx.stroke();
            
            // 绘制镜像波形
            ctx.beginPath();
            for (let i = 0; i < points; i++) {
                const x = i * barWidth;
                const dataIndex = Math.floor((i / points) * (dataArray.length * 0.6));
                const frequency = dataArray[dataIndex] || 0;
                const normalizedFreq = frequency / 255;
                const waveHeight = normalizedFreq * layer.amplitude * volume * (height * 0.4);
                const waveOffset = Math.sin(i * 0.05 + time * layer.speed + layer.offset) * 10;
                const distanceFromCenter = Math.abs(i - points / 2) / (points / 2);
                const centerMultiplier = 1 - distanceFromCenter * 0.5;
                const finalHeight = waveHeight * centerMultiplier + waveOffset;
                
                if (i === 0) {
                    ctx.moveTo(x, centerY + finalHeight);
                } else {
                    const prevX = (i - 1) * barWidth;
                    ctx.lineTo(x, centerY + finalHeight);
                }
            }
            ctx.stroke();
        });
        
        // 绘制中心发光效果
        const glowRadius = 80 + volume * 60;
        const gradient = ctx.createRadialGradient(
            centerX, centerY, 0,
            centerX, centerY, glowRadius
        );
        gradient.addColorStop(0, `rgba(0, 212, 255, ${0.2 + volume * 0.3})`);
        gradient.addColorStop(0.4, `rgba(112, 0, 255, ${0.1 + volume * 0.2})`);
        gradient.addColorStop(1, 'transparent');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        
        // 绘制中心圆点
        ctx.beginPath();
        ctx.arc(centerX, centerY, 8 + volume * 8, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0, 212, 255, ${0.6 + volume * 0.4})`;
        ctx.fill();
        
        // 中心圆点发光
        ctx.shadowBlur = 20 + volume * 20;
        ctx.shadowColor = 'rgba(0, 212, 255, 0.8)';
        ctx.fill();
        ctx.shadowBlur = 0;
    }
    
    // 绘制静态音波（未录音状态）
    drawIdleWave() {
        const ctx = this.ctx;
        const width = this.canvasWidth;
        const height = this.canvasHeight;
        const centerY = height / 2;
        const centerX = width / 2;
        const time = Date.now() * 0.001;
        
        ctx.clearRect(0, 0, width, height);
        
        // 绘制平缓的静态波形
        const layers = [
            { color: 'rgba(0, 212, 255, 0.15)', amplitude: 25, speed: 0.5, offset: 0 },
            { color: 'rgba(112, 0, 255, 0.1)', amplitude: 20, speed: 0.7, offset: 2 }
        ];
        
        layers.forEach((layer) => {
            ctx.beginPath();
            ctx.strokeStyle = layer.color;
            ctx.lineWidth = 2;
            ctx.lineCap = 'round';
            
            const points = 100;
            const sliceWidth = width / points;
            
            for (let i = 0; i <= points; i++) {
                const x = i * sliceWidth;
                const wave1 = Math.sin(i * 0.08 + time * layer.speed + layer.offset) * layer.amplitude;
                const wave2 = Math.sin(i * 0.15 - time * layer.speed * 0.5) * (layer.amplitude * 0.5);
                const y = centerY + wave1 + wave2;
                
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    const prevX = (i - 1) * sliceWidth;
                    const prevWave1 = Math.sin((i - 1) * 0.08 + time * layer.speed + layer.offset) * layer.amplitude;
                    const prevWave2 = Math.sin((i - 1) * 0.15 - time * layer.speed * 0.5) * (layer.amplitude * 0.5);
                    const prevY = centerY + prevWave1 + prevWave2;
                    
                    const cpX = (prevX + x) / 2;
                    ctx.quadraticCurveTo(prevX, prevY, cpX, (prevY + y) / 2);
                }
            }
            
            ctx.stroke();
        });
        
        // 中心静态光晕
        const gradient = ctx.createRadialGradient(
            centerX, centerY, 0,
            centerX, centerY, 60
        );
        gradient.addColorStop(0, 'rgba(0, 212, 255, 0.15)');
        gradient.addColorStop(0.5, 'rgba(112, 0, 255, 0.1)');
        gradient.addColorStop(1, 'transparent');
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        
        // 中心圆点
        ctx.beginPath();
        ctx.arc(centerX, centerY, 6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 212, 255, 0.4)';
        ctx.fill();
    }
    
    // 分析文本提取信息
    async analyzeText(text) {
        if (!text || text.length < 5) return;
        
        console.log('[VoiceAssistant] 开始分析文本:', text);
        
        // 同时运行本地规则分析（作为备用和对比）
        const localResult = this.localAnalyze(text);
        console.log('[VoiceAssistant] 本地规则分析结果:', localResult);
        
        // 优先使用千问API
        if (this.qwenAPI) {
            try {
                console.log('[VoiceAssistant] 使用千问API分析...');
                const result = await this.qwenAPI.analyzeCarInfo(text);
                console.log('[VoiceAssistant] 千问API分析结果:', result);
                this.updateResults(result);
            } catch (error) {
                console.warn('[VoiceAssistant] 千问API分析失败，使用本地规则:', error);
                // 降级到本地规则
                this.updateResults(localResult);
            }
        } else {
            console.log('[VoiceAssistant] 未配置API，使用本地规则');
            // 使用本地规则分析
            this.updateResults(localResult);
        }
    }
    
    // 本地规则分析
    localAnalyze(text) {
        const patterns = {
            carPrice: [
                // 匹配 "15万5"、"20万8千" 这样的口语表达
                /(?:车价|车辆价格|车款|总价|价格|预算|价位|想买个|想买).*?(\d+)万(\d+)(?:千|k|K)?/,
                /(\d+)万(\d+)(?:千|k|K)?.*?(?:的车|左右|预算|价位|左右的车|差不多)/,
                // 标准格式
                /(?:车价|车辆价格|车款|总价|价格|预算|价位|想买个|想买).*?(\d+(?:\.\d+)?)\s*(万|万元|w|W)/,
                /(\d+(?:\.\d+)?)\s*(万|万元|w|W).*?(?:的车|左右|预算|价位|左右的车)/,
            ],
            downPayment: [
                // 匹配 "2万5"、"3万8" 这样的口语表达
                /(?:首付|首付款|首付比例).*?(\d+)万(\d+)(?:千|k|K)?/,
                // 标准格式
                /(?:首付|首付款|首付比例).*?(\d+(?:\.\d+)?)\s*(万|万元|w|%|成|k|K)/,
                /(?:首付|首付款).*?(\d+(?:\.\d+)?)[\s%]*(?:百分之)?/,
                /(?:首付|首付款).*?(\d+)\s*成/,
                /(?:首付|首付款).*?(\d+)\s*[万千]/
            ],
            monthlyPayment: [
                // 匹配 "3千5"、"5千2" 这样的口语表达
                /(?:月供|每月|每个月|月还|还款).*?(\d+)千(\d+)(?:百|元|块)?/,
                // 标准格式
                /(?:月供|每月|每个月|月还|还款).*?(\d+(?:\.\d+)?)\s*(千|k|K|元|块)/,
                /(?:月供|每月还款|月还款).*?(?:不超过|大概|大约|在|是|控制).*?(\d{3,5})/,
                /(\d{3,5}).*?(?:的月供|一个月|每月|月供|还款)/,
                /(?:每个月|月供|月还).*?(\d+)\s*(千|k|K)/
            ],
            loanTerm: [
                /(?:贷款|分期|按揭|分).*?(\d+)\s*(年|期|个月|月)/,
                /(?:分|做|选|选做|办|选择|分期).{0,5}(\d+)\s*(年|期|个月|月)/,
                /(\d+)\s*(年|期|个月|月).{0,5}(?:分期|贷款|按揭)/,
                /(?:贷款|分期).{0,3}(\d+)[年]/
            ]
        };
        
        const results = {};
        
        for (const [key, regexList] of Object.entries(patterns)) {
            for (const regex of regexList) {
                const match = text.match(regex);
                if (match) {
                    let value, unit, extra;
                    
                    // 检查是否是 "X万Y" 格式（两个捕获组）
                    if (match[2] && !isNaN(match[2]) && 
                        (key === 'carPrice' || key === 'downPayment') && 
                        text.includes(match[1] + '万' + match[2])) {
                        // 处理 "2万5" 这种格式
                        const wan = parseFloat(match[1]);
                        const qian = parseFloat(match[2]);
                        // "2万5" = 2.5万，"2万5千" = 2.5万
                        value = wan + qian / 10;
                        unit = '万';
                    } else if (match[2] && !isNaN(match[2]) && 
                               key === 'monthlyPayment' && 
                               text.includes(match[1] + '千' + match[2])) {
                        // 处理 "3千5" 这种格式
                        const qian = parseFloat(match[1]);
                        const bai = parseFloat(match[2]);
                        value = qian * 1000 + bai * 100;
                        unit = '元';
                    } else {
                        value = match[1];
                        unit = match[2] || '';
                    }
                    
                    results[key] = this.formatValue(key, value, unit);
                    break;
                }
            }
        }
        
        return results;
    }
    
    // 格式化提取的值
    formatValue(key, value, unit) {
        const num = parseFloat(value);
        
        // 处理 NaN 情况
        if (isNaN(num)) return null;
        
        switch (key) {
            case 'carPrice':
                if (unit === '万' || unit === '万元' || unit === 'w' || unit === 'W') {
                    return `${num}万元`;
                }
                return num >= 10000 ? `${(num / 10000).toFixed(1)}万元` : `${num}元`;
                
            case 'downPayment':
                if (unit === '%' || unit.includes('成')) {
                    return unit.includes('成') ? `${num * 10}%` : `${num}%`;
                }
                if (unit === 'k' || unit === 'K' || unit === '千') {
                    return `${num}千元`;
                }
                return unit === '万' || unit === '万元' || unit === 'w' || unit === 'W' 
                    ? `${num}万元` 
                    : `${num}元`;
                    
            case 'monthlyPayment':
                if (unit === '千' || unit === 'k' || unit === 'K') {
                    return `${num}千元`;
                }
                if (unit === '元' || unit === '块' || !unit) {
                    return `${Math.round(num)}元`;
                }
                return num < 10000 ? `${num}元` : `${(num / 10000).toFixed(1)}万元`;
                
            case 'loanTerm':
                if (unit === '年') {
                    return num <= 10 ? `${num}年` : `${Math.floor(num / 12)}年`;
                }
                if (unit === '个月' || unit === '月') {
                    return num >= 12 ? `${Math.floor(num / 12)}年` : `${num}个月`;
                }
                if (unit === '期') {
                    const years = Math.floor(num / 12);
                    return years > 0 ? `${years}年` : `${num}个月`;
                }
                return `${num}期`;
                
            default:
                return value;
        }
    }
    
    // 更新分析结果
    updateResults(results) {
        for (const [key, value] of Object.entries(results)) {
            if (value && this.infoElements[key]) {
                this.updateInfoDisplay(key, value);
            }
        }
        
        // 隐藏分析中指示器
        if (Object.keys(results).length > 0) {
            this.typingIndicator.classList.remove('active');
        }
    }
    
    // 更新信息展示
    updateInfoDisplay(key, value) {
        const element = this.infoElements[key];
        const item = this.infoItems[key];
        
        if (element && value) {
            element.textContent = value;
            element.classList.add('extracted');
            
            // 高亮动画
            if (item) {
                item.classList.remove('highlight');
                void item.offsetWidth; // 触发重排
                item.classList.add('highlight');
                setTimeout(() => item.classList.remove('highlight'), 600);
            }
        }
    }
    
    // 显示提示
    showToast(message, duration = 3000) {
        this.toast.textContent = message;
        this.toast.classList.add('show');
        
        if (this.toastTimeout) {
            clearTimeout(this.toastTimeout);
        }
        
        this.toastTimeout = setTimeout(() => {
            this.toast.classList.remove('show');
        }, duration);
    }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', () => {
    window.voiceAssistant = new VoiceCarAssistant();
    
    // 保持页面活跃（防止iOS休眠）
    if (window.navigator && window.navigator.wakeLock) {
        navigator.wakeLock.request('screen').catch(() => {});
    }
});

// 防止页面滚动和缩放
document.addEventListener('touchmove', (e) => {
    if (e.target.closest('.info-card')) return;
    e.preventDefault();
}, { passive: false });

document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
document.addEventListener('gestureend', (e) => e.preventDefault());

// 防止双击缩放
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
        e.preventDefault();
    }
    lastTouchEnd = now;
}, false);
