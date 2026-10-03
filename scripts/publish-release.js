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
    const releaseName = `v${version}: 重构Token数值显示排版与双模单位系统`;
    const releaseBody = `## 🚀 Antigravity Cockpit v${version}

### 🎨 优雅重构 Token 数值显示与排版体系
- **彻底告别视觉突兀**：解决单一「万」单位导致的大数视觉臃肿问题（如 \`163381.94 万\`），重构为行业标准与中文自然进阶双模体系；
- **双模单位自由切换**：
  - **M / B（行业标准）**：采用全球 AI 平台与开发者通用标准（如 \`1.63 B\`、\`39.07 M\`）；
  - **万 / 亿（中文习惯）**：采用中文大数自然进阶（如 \`16.34 亿\`、\`3906.67 万\`）；
  - 支持在顶部工具栏一键切换，并持久化保存至本地存储；
- **排版字号落差分离**：大号加粗等宽数值搭配精致小号副单位标签（\`B\`、\`M\`、\`亿\`、\`万\`、\`天\`），布局极富呼吸感与现代感；
- **卡片交互式精度查看**：鼠标悬停在卡片数值上即刻浮现完整千分位精确 Token 计数（如 \`1,633,819,400 Tokens\`），点击数值卡片亦可瞬间切换单位模式；
- **图表与列表同步精简**：趋势图 Y 轴、悬停浮层、分布饼图和模型列表同步更新为统一的规整格式。
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

