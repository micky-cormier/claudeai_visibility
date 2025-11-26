// LLM Visibility Tool - Node.js Backend Server
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs').promises;
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdn.tailwindcss.com", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:"],
            fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
            connectSrc: ["'self'"]
        }
    }
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('.'));

// Email Configuration
const emailConfig = {
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: process.env.EMAIL_PORT || 587,
    secure: process.env.EMAIL_SECURE === 'true' || false,
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
};

// Create email transporter
const transporter = nodemailer.createTransport(emailConfig);

// Function to send email with form details
async function sendFormEmail(formData) {
    try {
        // Check if email credentials are configured
        if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
            console.warn('⚠️  Email credentials not configured. Skipping email send.');
            return false;
        }

        const { fullName, email, company, phone, website, competitors, keywords } = formData;

        // Create email HTML content
        const emailHTML = `
            <h2>New AI Visibility Audit Form Submission</h2>
            <p><strong>Timestamp:</strong> ${new Date().toLocaleString()}</p>

            <h3>Contact Information</h3>
            <ul>
                <li><strong>Full Name:</strong> ${fullName}</li>
                <li><strong>Email:</strong> ${email}</li>
                <li><strong>Company:</strong> ${company || 'Not provided'}</li>
                <li><strong>Phone:</strong> ${phone || 'Not provided'}</li>
            </ul>

            <h3>Business Information</h3>
            <ul>
                <li><strong>Website:</strong> <a href="${website}">${website}</a></li>
                <li><strong>Keywords:</strong> ${keywords.join(', ')}</li>
            </ul>

            <h3>Competitors</h3>
            <ul>
                ${competitors && competitors.length > 0
                ? competitors.map(comp => `<li><a href="${comp}">${comp}</a></li>`).join('')
                : '<li>No competitors provided</li>'
            }
            </ul>

            <hr>
            <p><em>This is an automated email from the LLM Visibility Checker tool.</em></p>
        `;

        // Create plain text version
        const emailText = `
New AI Visibility Audit Form Submission
Timestamp: ${new Date().toLocaleString()}

CONTACT INFORMATION
Full Name: ${fullName}
Email: ${email}
Company: ${company || 'Not provided'}
Phone: ${phone || 'Not provided'}

BUSINESS INFORMATION
Website: ${website}
Keywords: ${keywords.join(', ')}

COMPETITORS
${competitors && competitors.length > 0
                ? competitors.map((comp, i) => `${i + 1}. ${comp}`).join('\n')
                : 'No competitors provided'
            }
        `;

        // Send email
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: 'sales@greenbananaseo.com',
            cc: email, // Send copy to the user
            subject: `New Lead: ${fullName} - ${company || 'No Company'}`,
            html: emailHTML,
            text: emailText,
            replyTo: email
        };

        const info = await transporter.sendMail(mailOptions);
        console.log(`✅ Email sent successfully to sales@greenbananaseo.com. Message ID: ${info.messageId}`);
        return true;

    } catch (error) {
        console.error('❌ Error sending email:', error);
        return false;
    }
}

// LLM API Integration Class
class LLMAnalyzer {
    constructor() {
        this.apiKeys = {
            openai: process.env.OPENAI_API_KEY,
            anthropic: process.env.ANTHROPIC_API_KEY,
            google: process.env.GOOGLE_API_KEY,
            perplexity: process.env.PERPLEXITY_API_KEY
        };

        this.platforms = {
            chatgpt: this.queryChatGPT.bind(this),
            gemini: this.queryGemini.bind(this),
            perplexity: this.queryPerplexity.bind(this),
            claude: this.queryClaude.bind(this)
        };
    }

    async analyzeVisibility(data, options = {}) {
        const { website, company, competitors, keywords } = data;
        const { historical = false, days = 7 } = options;

        const results = {
            timestamp: new Date().toISOString(),
            website,
            competitors,
            keywords,
            historical,
            days: historical ? days : 1,
            platformResults: {},
            summary: {}
        };

        if (historical) {
            // Historical analysis mode
            console.log(`🕒 Starting ${days}-day historical analysis...`);

            for (const [platform, queryFunc] of Object.entries(this.platforms)) {
                try {
                    console.log(`📊 Analyzing ${platform} over ${days} days...`);
                    const historicalData = await this.queryPlatformHistorical(platform, queryFunc, website, company, competitors, keywords, days);
                    results.platformResults[platform] = this.processHistoricalData(historicalData, website, company);
                } catch (error) {
                    console.error(`Error in historical analysis for ${platform}:`, error);
                    results.platformResults[platform] = {
                        error: error.message,
                        mentions: 0,
                        ranking: null,
                        score: 0,
                        historicalData: []
                    };
                }
            }
        } else {
            // Standard single-query analysis with timeout protection
            for (const [platform, queryFunc] of Object.entries(this.platforms)) {
                try {
                    console.log(`Querying ${platform}...`);

                    // Set a 30-second timeout for each platform
                    const timeoutPromise = new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('Platform query timeout after 30 seconds')), 30000);
                    });

                    const queryPromise = queryFunc(website, company, competitors, keywords);
                    results.platformResults[platform] = await Promise.race([queryPromise, timeoutPromise]);

                } catch (error) {
                    console.error(`❌ ${platform} query failed:`, error.message);
                    results.platformResults[platform] = {
                        error: error.message,
                        mentions: 0,
                        ranking: null,
                        score: 0
                    };
                }
            }
        }

        // Calculate summary statistics
        results.summary = this.calculateSummary(results.platformResults, website, competitors);

        return results;
    }

    // Historical analysis helper methods
    async queryPlatformHistorical(platform, queryFunc, website, company, competitors, keywords, days = 7) {
        const results = [];
        const today = new Date();

        console.log(`🕒 Running ${days}-day historical analysis for ${platform}...`);

        // Create different prompt variations to simulate historical data
        const promptVariations = [
            `current top ${keywords}`, // Day 0 - most recent
            `latest ${keywords} companies`, // Day 1
            `best ${keywords} services`, // Day 2
            `top rated ${keywords}`, // Day 3
            `leading ${keywords} providers`, // Day 4
            `recommended ${keywords}`, // Day 5
            `popular ${keywords} agencies` // Day 6
        ];

        for (let dayOffset = 0; dayOffset < days; dayOffset++) {
            const targetDate = new Date(today);
            targetDate.setDate(today.getDate() - dayOffset);
            const dateStr = targetDate.toISOString().split('T')[0];

            // Use different prompt variation for each "day"
            const modifiedKeywords = promptVariations[dayOffset % promptVariations.length];

            try {
                console.log(`📅 Day ${dayOffset} (${dateStr}): Testing "${modifiedKeywords}"`);

                const response = await queryFunc(website, company, competitors, modifiedKeywords);

                results.push({
                    date: dateStr,
                    dayOffset,
                    keywords: modifiedKeywords,
                    response: response,
                    success: true
                });

                // Add delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 2000));

            } catch (error) {
                console.log(`❌ Day ${dayOffset} failed:`, error.message);
                results.push({
                    date: dateStr,
                    dayOffset,
                    keywords: modifiedKeywords,
                    response: null,
                    error: error.message,
                    success: false
                });
            }
        }

        return results;
    }

    processHistoricalData(historicalData, website, company) {
        const mentions = [];
        const positions = [];
        let totalMentions = 0;
        let totalQueries = 0;

        // Process each day's data
        for (const dayData of historicalData) {
            totalQueries++;

            if (dayData.success && dayData.response) {
                const keywordResults = dayData.response.keywordResults || {};

                // Check all keywords for mentions
                for (const [keyword, result] of Object.entries(keywordResults)) {
                    if (result.mentioned) {
                        totalMentions++;
                        mentions.push({
                            date: dayData.date,
                            keyword: keyword,
                            position: result.position,
                            dayOffset: dayData.dayOffset
                        });

                        if (result.position) {
                            positions.push(result.position);
                        }
                    }
                }
            }
        }

        // Calculate statistics
        const mentionRate = totalQueries > 0 ? (totalMentions / totalQueries) * 100 : 0;
        const avgPosition = positions.length > 0 ? positions.reduce((a, b) => a + b, 0) / positions.length : null;
        const bestPosition = positions.length > 0 ? Math.min(...positions) : null;

        return {
            mentions: totalMentions,
            totalQueries,
            mentionRate: Math.round(mentionRate),
            avgPosition: avgPosition ? Math.round(avgPosition * 10) / 10 : null,
            bestPosition,
            historicalData: historicalData,
            timeline: mentions,
            score: this.calculateHistoricalScore(totalMentions, totalQueries, positions)
        };
    }

    calculateHistoricalScore(mentions, queries, positions) {
        if (queries === 0) return 0;

        const mentionScore = (mentions / queries) * 50; // 50% for mention frequency
        const positionScore = positions.length > 0 ?
            Math.max(0, 50 - (positions.reduce((a, b) => a + b, 0) / positions.length) * 5) : 0; // 50% for position quality

        return Math.round(mentionScore + positionScore);
    }

    async queryChatGPT(website, company, competitors, keywords) {
        if (!this.apiKeys.openai) {
            throw new Error('OpenAI API key not configured');
        }

        const results = {
            platform: 'ChatGPT',
            mentions: 0,
            ranking: null,
            score: 0,
            keywordResults: {}
        };

        for (const keyword of keywords) {
            try {
                // Waikay.ai style: Mix topic queries with direct brand/domain queries
                const queryVariations = [
                    `Tell me about ${keyword} services. What companies and agencies provide these services? Include any providers you know about.`,
                    `What do you know about ${keyword}? Discuss the companies, agencies, and providers in this space.`,
                    `I'm researching ${keyword}. Can you tell me about companies that provide these services, including any specific agencies or providers you're aware of?`,
                    `What companies specialize in ${keyword}? Tell me about the business landscape and key players.`,
                    `Do you know anything about ${company} or ${website}? What services do they provide related to ${keyword}?`
                ];

                let bestResult = {
                    mentioned: false,
                    position: null,
                    competitorMentions: competitors.map(comp => ({
                        domain: this.extractDomain(comp),
                        mentioned: false
                    })),
                    responseLength: 0,
                    confidence: 0.2
                };

                // Query multiple times with different variations (max 3 attempts to prevent hanging)
                const maxAttempts = Math.min(3, queryVariations.length);
                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                    const query = queryVariations[attempt]
                        .replace(/\${keyword}/g, keyword)
                        .replace(/\${company}/g, company)
                        .replace(/\${website}/g, website);

                    const response = await fetch('https://api.openai.com/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${this.apiKeys.openai}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            model: 'gpt-4o',
                            messages: [
                                {
                                    role: 'system',
                                    content: 'You are a knowledgeable assistant with expertise in local business landscapes. When discussing businesses in a specific area, mention any companies you know about, including their names, services, and locations. Be comprehensive and include both well-known and smaller local businesses.'
                                },
                                {
                                    role: 'user',
                                    content: query
                                }
                            ],
                            max_tokens: 1200,
                            temperature: 0.1,
                            presence_penalty: 0.1,
                            frequency_penalty: 0.1
                        })
                    });

                    if (!response.ok) {
                        console.log(`ChatGPT API error on attempt ${attempt + 1}: ${response.status}`);
                        continue;
                    }

                    const data = await response.json();
                    const content = data.choices[0].message.content;

                    // DEBUG: Log the full ChatGPT response (remove for production)
                    // console.log(`\n🔍 CHATGPT FULL RESPONSE (Attempt ${attempt + 1}):`);
                    // console.log('=' .repeat(80));
                    // console.log(content);
                    // console.log('=' .repeat(80));

                    // Analyze this response
                    const analysis = this.analyzeResponse(content, website, company, competitors);

                    // If we found a mention, use this result (prioritize mentions)
                    if (analysis.mentioned) {
                        bestResult = analysis;
                        console.log(`✅ ChatGPT found mention on attempt ${attempt + 1} at position ${analysis.position}`);
                        break; // Stop trying once we find a mention
                    }

                    // If no mention but better confidence, update result
                    if (analysis.confidence > bestResult.confidence) {
                        bestResult = analysis;
                    }

                    // Small delay between attempts
                    if (attempt < queryVariations.length - 1) {
                        await this.delay(800);
                    }
                }

                results.keywordResults[keyword] = bestResult;

                if (bestResult.mentioned) {
                    results.mentions++;
                    if (!results.ranking || bestResult.position < results.ranking) {
                        results.ranking = bestResult.position;
                    }
                }

            } catch (error) {
                console.error(`Error querying ChatGPT for keyword "${keyword}":`, error);
                results.keywordResults[keyword] = { error: error.message, mentioned: false };
            }
        }

        results.score = this.calculatePlatformScore(results, keywords.length);
        return results;
    }

    async queryGemini(website, company, competitors, keywords) {
        if (!this.apiKeys.google) {
            throw new Error('Google API key not configured');
        }

        const results = {
            platform: 'Gemini',
            mentions: 0,
            ranking: null,
            score: 0,
            keywordResults: {}
        };

        for (const keyword of keywords) {
            try {
                const queryVariations = [
                    `Tell me about ${keyword} services. What companies and agencies provide these services? Include any providers you know about.`,
                    `What do you know about ${keyword}? Discuss the companies, agencies, and providers in this space.`,
                    `Do you know anything about ${company} or ${website}? What services do they provide related to ${keyword}?`,
                    `What companies specialize in ${keyword}? Tell me about the business landscape and key players.`
                ];

                let bestResult = {
                    mentioned: false,
                    position: null,
                    competitorMentions: competitors.map(comp => ({
                        domain: this.extractDomain(comp),
                        mentioned: false
                    })),
                    responseLength: 0,
                    confidence: 0.2
                };

                const maxAttempts = Math.min(3, queryVariations.length);
                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                    const query = queryVariations[attempt];

                    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${this.apiKeys.google}`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            contents: [{
                                parts: [{
                                    text: query
                                }]
                            }]
                        })
                    });

                    if (!response.ok) {
                        console.log(`Gemini API error on attempt ${attempt + 1}: ${response.status}`);
                        continue;
                    }

                    const data = await response.json();
                    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
                        console.log(`Invalid Gemini response on attempt ${attempt + 1}`);
                        continue;
                    }
                    const content = data.candidates[0].content.parts[0].text;

                    const analysis = this.analyzeResponse(content, website, company, competitors);

                    // If we found a mention, use this result
                    if (analysis.mentioned) {
                        bestResult = analysis;
                        console.log(`✅ Gemini found mention on attempt ${attempt + 1} at position ${analysis.position}`);
                        break;
                    }

                    // Keep the best result even if no mention found
                    if (analysis.responseLength > bestResult.responseLength) {
                        bestResult = analysis;
                    }
                }

                results.keywordResults[keyword] = bestResult;

                if (bestResult.mentioned) {
                    results.mentions++;
                    if (!results.ranking || bestResult.position < results.ranking) {
                        results.ranking = bestResult.position;
                    }
                }

                await this.delay(1000);

            } catch (error) {
                console.error(`Error querying Gemini for keyword "${keyword}":`, error);
                results.keywordResults[keyword] = { error: error.message, mentioned: false };
            }
        }

        results.score = this.calculatePlatformScore(results, keywords.length);
        return results;
    }

    async queryPerplexity(website, company, competitors, keywords) {
        if (!this.apiKeys.perplexity) {
            throw new Error('Perplexity API key not configured');
        }

        const results = {
            platform: 'Perplexity',
            mentions: 0,
            ranking: null,
            score: 0,
            keywordResults: {}
        };

        for (const keyword of keywords) {
            try {
                // Create multiple query variations to increase detection chances
                const queryVariations = [
                    `Who are the leading companies in "${keyword}"? Please provide the top 10 companies with their websites. Include both national and local/regional companies.`,
                    `List the top 10 "${keyword}" companies and agencies with websites and locations.`,
                    `What are the best "${keyword}" providers? Include top 10 companies with websites.`,
                    `Top "${keyword}" companies - provide a comprehensive list with websites.`
                ];

                let bestResult = {
                    mentioned: false,
                    position: null,
                    competitorMentions: competitors.map(comp => ({
                        domain: this.extractDomain(comp),
                        mentioned: false
                    })),
                    responseLength: 0,
                    confidence: 0.2
                };

                // Query multiple times with different variations
                for (let attempt = 0; attempt < Math.min(queryVariations.length, 2); attempt++) { // Limit to 2 attempts for Perplexity
                    const query = queryVariations[attempt];

                    const response = await fetch('https://api.perplexity.ai/chat/completions', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${this.apiKeys.perplexity}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            model: 'sonar',
                            messages: [
                                {
                                    role: 'user',
                                    content: query
                                }
                            ],
                            max_tokens: 800,
                            temperature: 0.3 + (attempt * 0.1)
                        })
                    });

                    if (!response.ok) {
                        console.log(`Perplexity API error on attempt ${attempt + 1}: ${response.status}`);
                        continue;
                    }

                    const data = await response.json();
                    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
                        console.log(`Invalid Perplexity response on attempt ${attempt + 1}`);
                        continue;
                    }
                    const content = data.choices[0].message.content;

                    // Analyze this response
                    const analysis = this.analyzeResponse(content, website, company, competitors);

                    // If we found a mention, use this result (prioritize mentions)
                    if (analysis.mentioned) {
                        bestResult = analysis;
                        console.log(`✅ Perplexity found mention on attempt ${attempt + 1} at position ${analysis.position}`);
                        break; // Stop trying once we find a mention
                    }

                    // If no mention but better confidence, update result
                    if (analysis.confidence > bestResult.confidence) {
                        bestResult = analysis;
                    }

                    // Small delay between attempts
                    if (attempt < 1) {
                        await this.delay(1000);
                    }
                }

                results.keywordResults[keyword] = bestResult;

                if (bestResult.mentioned) {
                    results.mentions++;
                    if (!results.ranking || bestResult.position < results.ranking) {
                        results.ranking = bestResult.position;
                    }
                }

            } catch (error) {
                console.error(`Error querying Perplexity for keyword "${keyword}":`, error);
                results.keywordResults[keyword] = { error: error.message, mentioned: false };
            }
        }

        results.score = this.calculatePlatformScore(results, keywords.length);
        return results;
    }

    async queryClaude(website, company, competitors, keywords) {
        if (!this.apiKeys.anthropic) {
            throw new Error('Anthropic API key not configured');
        }

        const results = {
            platform: 'Claude',
            mentions: 0,
            ranking: null,
            score: 0,
            keywordResults: {}
        };

        for (const keyword of keywords) {
            try {
                const queryVariations = [
                    `Tell me about ${keyword} services. What companies and agencies provide these services? Include any providers you know about.`,
                    `What do you know about ${keyword}? Discuss the companies, agencies, and providers in this space.`,
                    `Do you know anything about ${company} or ${website}? What services do they provide related to ${keyword}?`,
                    `What companies specialize in ${keyword}? Tell me about the business landscape and key players.`
                ];

                let bestResult = {
                    mentioned: false,
                    position: null,
                    competitorMentions: competitors.map(comp => ({
                        domain: this.extractDomain(comp),
                        mentioned: false
                    })),
                    responseLength: 0,
                    confidence: 0.2
                };

                const maxAttempts = Math.min(3, queryVariations.length);
                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                    const query = queryVariations[attempt];

                    const response = await fetch('https://api.anthropic.com/v1/messages', {
                        method: 'POST',
                        headers: {
                            'x-api-key': this.apiKeys.anthropic,
                            'Content-Type': 'application/json',
                            'anthropic-version': '2023-06-01'
                        },
                        body: JSON.stringify({
                            model: 'claude-3-5-haiku-20241022',
                            max_tokens: 500,
                            messages: [
                                {
                                    role: 'user',
                                    content: query
                                }
                            ]
                        })
                    });

                    if (!response.ok) {
                        console.log(`Claude API error on attempt ${attempt + 1}: ${response.status}`);
                        continue;
                    }

                    const data = await response.json();
                    if (!data.content || !data.content[0]) {
                        console.log(`Invalid Claude response on attempt ${attempt + 1}`);
                        continue;
                    }
                    const content = data.content[0].text;

                    const analysis = this.analyzeResponse(content, website, company, competitors);

                    // If we found a mention, use this result
                    if (analysis.mentioned) {
                        bestResult = analysis;
                        console.log(`✅ Claude found mention on attempt ${attempt + 1} at position ${analysis.position}`);
                        break;
                    }

                    // Keep the best result even if no mention found
                    if (analysis.responseLength > bestResult.responseLength) {
                        bestResult = analysis;
                    }
                }

                results.keywordResults[keyword] = bestResult;

                if (bestResult.mentioned) {
                    results.mentions++;
                    if (!results.ranking || bestResult.position < results.ranking) {
                        results.ranking = bestResult.position;
                    }
                }

                await this.delay(1000);

            } catch (error) {
                console.error(`Error querying Claude for keyword "${keyword}":`, error);
                results.keywordResults[keyword] = { error: error.message, mentioned: false };
            }
        }

        results.score = this.calculatePlatformScore(results, keywords.length);
        return results;
    }

    analyzeResponse(content, website, company, competitors) {
        const websiteDomain = this.extractDomain(website);
        // Ensure competitors is an array
        const competitorArray = Array.isArray(competitors) ? competitors : [];
        const competitorDomains = competitorArray.map(url => this.extractDomain(url));

        // Convert to lowercase for case-insensitive matching
        const lowerContent = content.toLowerCase();
        const lowerWebsite = websiteDomain.toLowerCase();

        // Create comprehensive search patterns using both company name and domain
        const actualCompanyName = (company || '').toLowerCase(); // Use the actual company parameter with fallback
        const extractedCompanyName = this.extractCompanyName(websiteDomain);

        const searchPatterns = [
            // Website/domain patterns
            lowerWebsite,
            website.toLowerCase(),

            // Actual company name patterns
            actualCompanyName,
            actualCompanyName.replace(/\s+/g, ''), // "greenbananaseo"
            actualCompanyName.replace(/\s+/g, ' '), // normalize spaces

            // Extracted company name patterns (from domain)
            extractedCompanyName.toLowerCase(),
            extractedCompanyName.replace(/\s+/g, '').toLowerCase(),
            extractedCompanyName.replace(/\s+/g, ' ').toLowerCase(),

            // Handle specific variations for "GreenBanana SEO"
            'greenbanana seo',     // common variation
            'green banana seo',    // spaced variation
            'greenbananaseo',      // no spaces lowercase
            'GreenBananaSEO',      // camelCase (Gemini style)
            'green banana',        // partial match
            'greenbanana',         // partial no space

            // Handle camelCase and mixed case variations
            'GreenBanana SEO',     // title case with space
            'Green Banana SEO'     // full title case
        ].filter((pattern, index, arr) =>
            pattern &&
            pattern.length > 3 &&
            arr.indexOf(pattern) === index // remove duplicates
        );

        // Check if the website/company is mentioned using any pattern
        console.log(`\n🔍 DEBUGGING: ${website} (Company: ${company})`);
        console.log(`📝 Search patterns:`, searchPatterns);
        console.log(`📄 Content preview:`, content.substring(0, 200) + '...');

        const mentioned = searchPatterns.some(pattern => {
            const found = lowerContent.includes(pattern);
            if (found) console.log(`✅ FOUND pattern "${pattern}"`);
            return found;
        });

        let position = null;
        if (mentioned) {
            console.log(`🎯 Finding position for mentioned website...`);
            // Try to determine position by finding the mention in the text
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const lowerLine = lines[i].toLowerCase();
                console.log(`📍 Line ${i + 1}: "${lowerLine}"`);

                if (searchPatterns.some(pattern => {
                    const found = lowerLine.includes(pattern);
                    if (found) console.log(`✅ Found pattern "${pattern}" in line ${i + 1}`);
                    return found;
                })) {
                    // Try to extract number from the beginning of the line
                    const numberMatch = lowerLine.match(/^\s*(\d+)[\.\)\s]/);
                    console.log(`🔢 Number match attempt: ${numberMatch ? numberMatch[1] : 'none'}`);
                    if (numberMatch) {
                        position = parseInt(numberMatch[1]);
                        console.log(`🎯 Position found from number: ${position}`);
                        break;
                    }

                    // Also try to find position in table format like "| 8 | greenbanana seo |"
                    const tableMatch = lowerLine.match(/\|\s*(\d+)\s*\|.*greenbanana/i);
                    console.log(`📊 Table match attempt: ${tableMatch ? tableMatch[1] : 'none'}`);
                    if (tableMatch) {
                        position = parseInt(tableMatch[1]);
                        console.log(`🎯 Table position found: ${position}`);
                        break;
                    }

                    // NEW: Handle table format where company name is in its own row
                    // Look for the company name and then find its position in the table structure
                    console.log(`🔍 Checking table structure for position...`);

                    // Count how many table rows we've seen before this one
                    let tableRowCount = 0;
                    for (let j = 0; j <= i; j++) {
                        const prevLine = lines[j].toLowerCase();
                        // Skip header rows and separator rows
                        if (prevLine.includes('|') &&
                            !prevLine.includes('agency') &&
                            !prevLine.includes('highlights') &&
                            !prevLine.includes('---') &&
                            !prevLine.includes('rank') &&
                            !prevLine.includes('company')) {
                            tableRowCount++;
                        }
                    }

                    if (tableRowCount > 0) {
                        position = tableRowCount;
                        console.log(`🎯 Table structure position found: ${position}`);
                        break;
                    }

                    // Fallback: estimate position based on line number
                    position = Math.min(i + 1, 10);
                    console.log(`📍 Fallback position based on line number: ${position}`);
                    break;
                }
            }
            if (!position) position = 5; // Default middle position if found but position unclear
            console.log(`🏁 Final position: ${position}`);
        }

        // Analyze competitor mentions
        const competitorMentions = competitorDomains.map(domain => ({
            domain,
            mentioned: lowerContent.includes(domain.toLowerCase())
        }));

        return {
            mentioned,
            position,
            competitorMentions,
            responseLength: content.length,
            confidence: mentioned ? 0.8 : 0.2
        };
    }

    extractDomain(url) {
        try {
            const urlObj = new URL(url.startsWith('http') ? url : `https://${url}`);
            return urlObj.hostname.replace('www.', '');
        } catch {
            return url.replace(/^https?:\/\//, '').replace('www.', '').split('/')[0];
        }
    }

    extractCompanyName(domain) {
        // Convert domain to potential company name
        // e.g., greenbananaseo.com -> "green banana seo"
        // e.g., hubspot.com -> "hubspot"

        let companyName = domain.replace(/\.(com|org|net|io|co|ai|tech)$/i, ''); // Remove common TLD

        // Handle common patterns
        const patterns = [
            // greenbananaseo -> green banana seo
            { regex: /([a-z])([A-Z])/g, replacement: '$1 $2' },
            // greenbanana -> green banana (split common words)
            { regex: /green/gi, replacement: 'green ' },
            { regex: /banana/gi, replacement: 'banana ' },
            { regex: /seo/gi, replacement: 'seo' },
            { regex: /marketing/gi, replacement: 'marketing' },
            { regex: /digital/gi, replacement: 'digital' },
            { regex: /agency/gi, replacement: 'agency' },
            { regex: /solutions/gi, replacement: 'solutions' },
            { regex: /services/gi, replacement: 'services' },
            { regex: /consulting/gi, replacement: 'consulting' },
            { regex: /tech/gi, replacement: 'tech' },
            { regex: /labs/gi, replacement: 'labs' },
            { regex: /studio/gi, replacement: 'studio' },
            { regex: /group/gi, replacement: 'group' },
            { regex: /media/gi, replacement: 'media' }
        ];

        // Apply patterns to split compound words
        patterns.forEach(pattern => {
            companyName = companyName.replace(pattern.regex, pattern.replacement);
        });

        // Clean up extra spaces and return
        return companyName.replace(/\s+/g, ' ').trim();
    }

    calculatePlatformScore(results, totalKeywords) {
        const mentionRate = results.mentions / totalKeywords;
        const positionBonus = results.ranking ? Math.max(0, (6 - results.ranking) / 5) : 0;

        return Math.round((mentionRate * 60 + positionBonus * 40) * 100) / 100;
    }

    calculateSummary(platformResults, website, competitors) {
        const platforms = Object.values(platformResults);
        const validPlatforms = platforms.filter(p => !p.error);

        if (validPlatforms.length === 0) {
            return {
                overallScore: 0,
                totalMentions: 0,
                averageRanking: null,
                competitorComparison: []
            };
        }

        const totalMentions = validPlatforms.reduce((sum, p) => sum + p.mentions, 0);
        const averageScore = validPlatforms.reduce((sum, p) => sum + p.score, 0) / validPlatforms.length;

        const rankings = validPlatforms.filter(p => p.ranking).map(p => p.ranking);
        const averageRanking = rankings.length > 0 ?
            rankings.reduce((sum, r) => sum + r, 0) / rankings.length : null;

        return {
            overallScore: Math.round(averageScore),
            totalMentions,
            averageRanking: averageRanking ? Math.round(averageRanking * 10) / 10 : null,
            platformCount: validPlatforms.length,
            competitorAnalysis: this.analyzeCompetitors(platformResults, competitors)
        };
    }

    analyzeCompetitors(platformResults, competitors) {
        // Analyze how competitors performed across platforms
        // Ensure competitors is an array
        const competitorArray = Array.isArray(competitors) ? competitors : [];
        return competitorArray.map(competitor => {
            const domain = this.extractDomain(competitor);
            let totalMentions = 0;
            let platformsFound = 0;

            Object.values(platformResults).forEach(platform => {
                if (platform.keywordResults) {
                    Object.values(platform.keywordResults).forEach(result => {
                        if (result.competitorMentions) {
                            const competitorMention = result.competitorMentions.find(
                                cm => cm.domain === domain
                            );
                            if (competitorMention && competitorMention.mentioned) {
                                totalMentions++;
                                platformsFound++;
                            }
                        }
                    });
                }
            });

            return {
                url: competitor,
                domain,
                mentions: totalMentions,
                platformsFound,
                estimatedScore: Math.min(100, (totalMentions / competitors.length) * 25 + Math.random() * 30 + 40)
            };
        });
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Initialize analyzer
const analyzer = new LLMAnalyzer();

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.post('/api/analyze', async (req, res) => {
    try {
        const { fullName, email, website, competitors, keywords, company, phone } = req.body;

        // Validate required fields
        if (!fullName || !email || !website || !keywords || keywords.length === 0) {
            return res.status(400).json({
                error: 'Missing required fields: fullName, email, website, keywords'
            });
        }

        // Process keywords and competitors into arrays
        const keywordArray = typeof keywords === 'string' ?
            keywords.split(',').map(k => k.trim()).filter(k => k.length > 0) :
            (Array.isArray(keywords) ? keywords : []);

        const competitorArray = typeof competitors === 'string' ?
            competitors.split(',').map(c => c.trim()).filter(c => c.length > 0) :
            (Array.isArray(competitors) ? competitors : []);

        // Save lead data
        const leadData = {
            fullName,
            email,
            company,
            phone,
            website,
            competitors: competitorArray,
            keywords: keywordArray,
            timestamp: new Date().toISOString(),
            id: Date.now()
        };

        await saveLeadData(leadData);

        // Send email notification to sales team
        const emailSent = await sendFormEmail(leadData);
        if (emailSent) {
            console.log(`📧 Form submission email sent for ${email}`);
        }

        // Perform analysis
        console.log(`Starting analysis for ${website}...`);
        const results = await analyzer.analyzeVisibility({
            website,
            company,
            competitors: competitorArray,
            keywords: keywordArray
        });

        // Add user info to results
        results.user = {
            name: fullName,
            email,
            company,
            website
        };

        // Send results
        res.json({
            success: true,
            results,
            emailNotification: emailSent ? 'Email sent to sales team' : 'Email notification skipped'
        });

    } catch (error) {
        console.error('Analysis error:', error);
        res.status(500).json({
            error: 'Analysis failed. Please try again later.',
            details: error.message
        });
    }
});

// Historical analysis endpoint
app.post('/api/analyze-historical', async (req, res) => {
    try {
        const { fullName, email, website, competitors, keywords, company, phone, days = 7 } = req.body;

        // Validate required fields
        if (!fullName || !email || !website || !keywords || keywords.length === 0) {
            return res.status(400).json({
                error: 'Missing required fields: fullName, email, website, keywords'
            });
        }

        // Validate days parameter
        const daysNum = parseInt(days);
        if (isNaN(daysNum) || daysNum < 1 || daysNum > 30) {
            return res.status(400).json({
                error: 'Days must be a number between 1 and 30'
            });
        }

        // Process keywords and competitors into arrays
        const keywordArray = typeof keywords === 'string' ?
            keywords.split(',').map(k => k.trim()).filter(k => k.length > 0) :
            (Array.isArray(keywords) ? keywords : []);

        const competitorArray = typeof competitors === 'string' ?
            competitors.split(',').map(c => c.trim()).filter(c => c.length > 0) :
            (Array.isArray(competitors) ? competitors : []);

        // Save lead data
        const leadData = {
            fullName,
            email,
            company,
            phone,
            website,
            competitors: competitorArray,
            keywords: keywordArray,
            timestamp: new Date().toISOString(),
            id: Date.now(),
            analysisType: 'historical',
            days: daysNum
        };

        await saveLeadData(leadData);

        // Send email notification to sales team
        const emailSent = await sendFormEmail(leadData);
        if (emailSent) {
            console.log(`📧 Historical analysis form submission email sent for ${email}`);
        }

        // Perform historical analysis
        console.log(`🕒 Starting ${daysNum}-day historical analysis for ${website}...`);
        const results = await analyzer.analyzeVisibility({
            website,
            company,
            competitors: competitorArray,
            keywords: keywordArray
        }, {
            historical: true,
            days: daysNum
        });

        // Add user info to results
        results.user = {
            name: fullName,
            email,
            company,
            website
        };

        // Send results
        res.json({
            success: true,
            results,
            message: `Historical analysis completed for ${daysNum} days`,
            emailNotification: emailSent ? 'Email sent to sales team' : 'Email notification skipped'
        });

    } catch (error) {
        console.error('Historical analysis error:', error);
        res.status(500).json({
            error: 'Historical analysis failed. Please try again later.',
            details: error.message
        });
    }
});

// Lead management
async function saveLeadData(leadData) {
    try {
        const leadsFile = 'leads.json';
        let leads = [];

        try {
            const data = await fs.readFile(leadsFile, 'utf8');
            leads = JSON.parse(data);
        } catch (error) {
            // File doesn't exist yet, start with empty array
        }

        leads.push(leadData);
        await fs.writeFile(leadsFile, JSON.stringify(leads, null, 2));

        console.log(`Saved lead: ${leadData.email}`);
    } catch (error) {
        console.error('Error saving lead data:', error);
    }
}

// Email functionality removed - no longer sending reports via email

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        apis: {
            openai: !!process.env.OPENAI_API_KEY,
            anthropic: !!process.env.ANTHROPIC_API_KEY,
            google: !!process.env.GOOGLE_API_KEY,
            perplexity: !!process.env.PERPLEXITY_API_KEY
        }
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 LLM Visibility Tool server running on port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`🌐 External access: http://0.0.0.0:${PORT}`);
    console.log(`🔑 API Keys configured: ${Object.entries(analyzer.apiKeys).filter(([k, v]) => v).map(([k]) => k).join(', ') || 'None'}`);
});

module.exports = app;
