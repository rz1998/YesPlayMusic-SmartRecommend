/**
 * 检查推荐 API 返回的 picUrl 数据
 * 用于诊断封面不显示问题
 */

const http = require('http');

// 测试推荐 API
function testRecommendAPI() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/recommend?userId=test_user&limit=5',
      method: 'GET',
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          console.log('\n=== 推荐 API 返回数据 ===');
          console.log('recommendations count:', json.recommendations?.length || 0);
          
          if (json.recommendations && json.recommendations.length > 0) {
            console.log('\n封面数据检查:');
            json.recommendations.forEach((song, i) => {
              console.log(`${i + 1}. ${song.name}`);
              console.log(`   picUrl: ${song.picUrl || 'EMPTY'}`);
              console.log(`   al.picUrl: ${song.al?.picUrl || 'N/A'}`);
              console.log('');
            });
          }
          resolve(json);
        } catch (e) {
          console.error('JSON 解析失败:', e.message);
          console.log('原始数据:', data.substring(0, 500));
          reject(e);
        }
      });
    });

    req.on('error', (e) => {
      console.error('请求失败:', e.message);
      reject(e);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });

    req.end();
  });
}

// 测试用户画像 API
function testProfileAPI() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/profile?userId=test_user',
      method: 'GET',
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          console.log('\n=== 用户画像 API 返回 ===');
          console.log(JSON.stringify(json, null, 2));
          resolve(json);
        } catch (e) {
          console.error('JSON 解析失败:', e.message);
          reject(e);
        }
      });
    });

    req.on('error', (e) => {
      console.error('请求失败:', e.message);
      reject(e);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('请求超时'));
    });

    req.end();
  });
}

async function main() {
  console.log('开始诊断封面图片问题...\n');
  
  try {
    await testRecommendAPI();
  } catch (e) {
    console.log('推荐 API 测试跳过');
  }

  try {
    await testProfileAPI();
  } catch (e) {
    console.log('画像 API 测试跳过');
  }

  console.log('\n诊断完成');
}

main();
