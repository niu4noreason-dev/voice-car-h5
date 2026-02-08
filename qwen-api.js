/**
 * 千问API集成模块
 * 用于调用千问32B模型进行语音内容分析
 */

class QwenAPI {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseURL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';
    }
    
    /**
     * 分析文本提取购车信息
     * @param {string} text - 用户语音转录的文本
     * @returns {Promise<Object>} - 提取的信息对象
     */
    async analyzeCarInfo(text) {
        if (!this.apiKey) {
            throw new Error('请先配置千问API Key');
        }
        
        const prompt = `请从以下用户购车相关的对话内容中，提取关键信息并以JSON格式返回。
如果没有找到某项信息，该字段返回null。

需要提取的字段：
- carPrice: 车辆价格（例如："15万元"、"20万"）
- downPayment: 首付款金额或比例（例如："5万元"、"30%"）
- monthlyPayment: 月供金额（例如："3000元"、"5000"）
- loanTerm: 贷款期限（例如："3年"、"36期"）

用户内容："${text}"

请只返回JSON格式，不要包含其他说明文字。格式示例：
{"carPrice": "15万元", "downPayment": "30%", "monthlyPayment": "3000元", "loanTerm": "3年"}`;

        try {
            const response = await fetch(this.baseURL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: 'qwen-32b-chat',
                    input: {
                        messages: [
                            {
                                role: 'system',
                                content: '你是一个专业的购车需求分析助手，擅长从用户对话中提取车辆价格、首付、月供、贷款期限等关键信息。'
                            },
                            {
                                role: 'user',
                                content: prompt
                            }
                        ]
                    },
                    parameters: {
                        result_format: 'message',
                        max_tokens: 500,
                        temperature: 0.1
                    }
                })
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'API请求失败');
            }
            
            const data = await response.json();
            const content = data.output?.choices?.[0]?.message?.content || '';
            
            // 解析JSON响应
            return this.parseResponse(content);
            
        } catch (error) {
            console.error('千问API调用失败:', error);
            throw error;
        }
    }
    
    /**
     * 解析API返回的内容
     * @param {string} content - API返回的文本内容
     * @returns {Object} - 解析后的信息对象
     */
    parseResponse(content) {
        try {
            // 尝试直接解析JSON
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                return {
                    carPrice: parsed.carPrice || parsed.车辆价格 || parsed.price || null,
                    downPayment: parsed.downPayment || parsed.首付款 || parsed.downpayment || null,
                    monthlyPayment: parsed.monthlyPayment || parsed.月供 || parsed.monthly || null,
                    loanTerm: parsed.loanTerm || parsed.贷款期限 || parsed.term || null
                };
            }
        } catch (e) {
            console.warn('JSON解析失败，尝试文本解析');
        }
        
        // 降级到正则匹配
        return this.fallbackParse(content);
    }
    
    /**
     * 备用解析方法
     * @param {string} content - API返回的文本内容
     * @returns {Object} - 解析后的信息对象
     */
    fallbackParse(content) {
        const result = {
            carPrice: null,
            downPayment: null,
            monthlyPayment: null,
            loanTerm: null
        };
        
        // 车辆价格
        const priceMatch = content.match(/(?:车价|价格|price)[":\s]*([^"\n,}]+)/i);
        if (priceMatch) result.carPrice = priceMatch[1].trim();
        
        // 首付款
        const downMatch = content.match(/(?:首付|down)[":\s]*([^"\n,}]+)/i);
        if (downMatch) result.downPayment = downMatch[1].trim();
        
        // 月供
        const monthlyMatch = content.match(/(?:月供|monthly)[":\s]*([^"\n,}]+)/i);
        if (monthlyMatch) result.monthlyPayment = monthlyMatch[1].trim();
        
        // 贷款期限
        const termMatch = content.match(/(?:期限|term)[":\s]*([^"\n,}]+)/i);
        if (termMatch) result.loanTerm = termMatch[1].trim();
        
        return result;
    }
}

// 导出模块
if (typeof module !== 'undefined' && module.exports) {
    module.exports = QwenAPI;
}
