const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

function getGitHubToken() {
    if (process.env.GITHUB_TOKEN) {
        return process.env.GITHUB_TOKEN;
    }
    if (process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
        return process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    }
    try {
        const homeDir = process.env.USERPROFILE || process.env.HOME || '';
        const mcpConfigPath = path.join(homeDir, '.gemini', 'config', 'mcp_config.json');
        if (fs.existsSync(mcpConfigPath)) {
            const mcpCfg = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
            const ghToken = mcpCfg?.mcpServers?.['github-mcp-server']?.env?.GITHUB_PERSONAL_ACCESS_TOKEN;
            if (ghToken) {
                return ghToken;
            }
        }
    } catch {
        // ignore
    }
    try {
        const output = execSync('git credential fill', {
            input: 'protocol=https\nhost=github.com\n\n',
            encoding: 'utf8',
            timeout: 5000
        });
        const match = output.match(/password=(.+)/);
        if (match) {
            return match[1].trim();
        }
    } catch (err) {
        console.error('Failed to get token from git credential:', err.message);
    }
    throw new Error('No GitHub token found');
}

function request(options, postData) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data || '{}'));
                    } catch {
                        resolve(data);
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', reject);
        if (postData) {
            req.write(postData);
        }
        req.end();
    });
}

function uploadAsset(uploadUrl, filePath, token) {
    return new Promise((resolve, reject) => {
        const fileName = path.basename(filePath);
        const fileStats = fs.statSync(filePath);
        const fileStream = fs.createReadStream(filePath);
        
        // uploadUrl is like: https://uploads.github.com/repos/owner/repo/releases/1234/assets{?name,label}
        const cleanUrl = uploadUrl.replace(/\{.*\}/, '');
        const targetUrl = new URL(`${cleanUrl}?name=${encodeURIComponent(fileName)}`);

        const options = {
            hostname: targetUrl.hostname,
            path: targetUrl.pathname + targetUrl.search,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'User-Agent': 'Node.js-Release-Script',
                'Content-Type': 'application/octet-stream',
                'Content-Length': fileStats.size
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(data || '{}'));
                    } catch {
                        resolve(data);
                    }
                } else {
                    reject(new Error(`Upload failed HTTP ${res.statusCode}: ${data}`));
                }
            });
        });
        req.on('error', reject);
        fileStream.pipe(req);
    });
}

async function main() {
    const token = getGitHubToken();
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
    const version = pkg.version;
    const owner = 'mmximxim';
    const repo = 'vscode-antigravity-cockpit';
    const tagName = `v${version}`;
    const releaseName = `v${version}: 原生集成真实Token统计与API商业价值折算`;
    const releaseBody = `## 🚀 Antigravity Cockpit v${version}

### 💎 原生集成本地真实 Token 统计与商业 API 价值折算
- **原生提取与解析**：直接从 Antigravity 本地对话数据库（\`~/.gemini/antigravity/conversations/*.db\`）精确解析底层 Protobuf 的实际使用 Token（包含输入、输出、思考、缓存命中等）；
- **商业 API 价值折算**：恢复并原生内置细分模型级别的官方商业 API 价值折算公式（Gemini Flash: $0.75/$3.75/$0.075 每百万 tokens；Claude: $3.00/$15.00/$0.30 每百万 tokens）；
- **统一单位显示**：Token 显示格式统一恢复为带有 2 位小数的「万」为单位（如 \`162533.54 万\`，取消过大的「亿」单位）；
- **高性能本地缓存**：内置本地增量时间戳文件缓存（\`real_tokens_cache.json\`），毫秒级极速载入；
- **今日消耗统计**：核心卡片支持实时呈现今日真实消耗 Tokens 与今日商业 API 价值。
`;

    console.log(`📌 创建/更新 GitHub Release: ${tagName} (${releaseName})...`);
    const releasePayload = JSON.stringify({
        tag_name: tagName,
        target_commitish: 'main',
        name: releaseName,
        body: releaseBody,
        draft: false,
        prerelease: false
    });

    const releaseOptions = {
        hostname: 'api.github.com',
        path: `/repos/${owner}/${repo}/releases`,
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'User-Agent': 'Node.js-Release-Script',
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(releasePayload)
        }
    };

    let release;
    try {
        release = await request(releaseOptions, releasePayload);
        console.log(`✅ Release 创建成功: ${release.html_url}`);
    } catch (err) {
        if (err.message.includes('already_exists')) {
            console.log(`ℹ️ Release ${tagName} 已存在，获取并更新现有 Release...`);
            release = await request({
                hostname: 'api.github.com',
                path: `/repos/${owner}/${repo}/releases/tags/${tagName}`,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'User-Agent': 'Node.js-Release-Script',
                    'Accept': 'application/vnd.github+json'
                }
            });
            const patchOptions = {
                hostname: 'api.github.com',
                path: `/repos/${owner}/${repo}/releases/${release.id}`,
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'User-Agent': 'Node.js-Release-Script',
                    'Accept': 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(releasePayload)
                }
            };
            release = await request(patchOptions, releasePayload);
            console.log(`✅ Release 更新成功: ${release.html_url}`);
        } else {
            throw err;
        }
    }

    const vsixPath = path.resolve(__dirname, '..', `antigravity-cockpit-github-style-${version}.vsix`);
    if (!fs.existsSync(vsixPath)) {
        console.error(`❌ 未找到 VSIX 文件: ${vsixPath}`);
        process.exit(1);
    }

    console.log(`📦 上传 VSIX 产物: ${vsixPath}...`);
    try {
        const asset = await uploadAsset(release.upload_url, vsixPath, token);
        console.log(`✅ 产物上传成功: ${asset.browser_download_url}`);
    } catch (err) {
        if (err.message.includes('already_exists')) {
            console.log(`⚠️ 产物已存在，跳过上传`);
        } else {
            throw err;
        }
    }

    console.log(`🎉 全部发布流程完成！`);
}

main().catch(err => {
    console.error('❌ 发布失败:', err);
    process.exit(1);
});

