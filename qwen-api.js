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
        
        const prompt = `任务：从用户购车对话中提取关键信息，以JSON格式返回。

提取规则：
1. carPrice（车辆价格）：提取用户提到的车辆预算或价格
   - 必须包含单位"万"或"元"
   - 口语表达转换："15万左右"→"15万元"，"20万出头"→"20万元"
   - "2万5" 或 "2万五" 应该解析为 "2.5万元"
   
2. downPayment（首付款）：提取首付金额或比例
   - 如果是金额：必须包含"万"或"元"单位
   - 口语转换："2万5"→"2.5万元"，"3万"→"3万元"，"百分之三十"→"30%"
   - "2万5"表示25000元 = 2.5万元，绝对不能只输出"25"
   - "2万五"也表示2.5万元
   
3. monthlyPayment（月供金额）：提取每月还款能力
   - 必须包含"元"单位
   - 口语转换："三千"→"3000元"，"5千左右"→"5000元"
   - "三千五"→"3500元"
   
4. loanTerm（贷款期限）：提取分期时长
   - 统一转换为"X年"或"X个月"
   - 口语转换："三年"→"3年"，"36期"→"3年"

严格规则：
- "2万5" 必须输出 "2.5万元"，只输出"25"是错误的
- "3万8" 必须输出 "3.8万元"
- 数值和单位必须完整，不能只返回数字
- 如果没有找到某项信息，该字段返回null

用户内容："${text}"

输出格式（严格JSON，不要markdown代码块）：
{"carPrice": "提取的价格或null", "downPayment": "提取的首付或null", "monthlyPayment": "提取的月供或null", "loanTerm": "提取的期限或null"}

示例1：
输入："我想买15万的车，首付2万5，月供3000左右"
输出：{"carPrice": "15万元", "downPayment": "2.5万元", "monthlyPayment": "3000元", "loanTerm": null}

示例2：
输入："预算20万，首付30%，分三年还"
输出：{"carPrice": "20万元", "downPayment": "30%", "monthlyPayment": null, "loanTerm": "3年"}

示例3：
输入："首付2万五左右"
输出：{"carPrice": null, "downPayment": "2.5万元", "monthlyPayment": null, "loanTerm": null}`;

        try {
            console.log('[QwenAPI] 发送请求，文本:', text);
            
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
                                content: '你是一个专业的购车需求分析助手，擅长从用户对话中提取车辆价格、首付、月供、贷款期限等关键信息。特别注意："2万5"应该解析为2.5万元，不是25。'
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
            
            console.log('[QwenAPI] 原始响应:', content);
            
            // 解析JSON响应
            const result = this.parseResponse(content);
            console.log('[QwenAPI] 解析结果:', result);
            
            return result;
            
        } catch (error) {
            console.error('[QwenAPI] 调用失败:', error);
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
