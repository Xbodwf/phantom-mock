const { chromium } = require('playwright');

async function test() {
  console.log('启动浏览器...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 }
  });
  const page = await context.newPage();
  
  const consoleMessages = [];
  page.on('console', msg => {
    consoleMessages.push({ type: msg.type(), text: msg.text() });
  });
  
  const errors = [];
  page.on('pageerror', error => {
    errors.push(error.message);
  });
  
  try {
    // 测试1: 首页
    console.log('\n=== 测试1: 导航到首页 ===');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle', timeout: 30000 });
    console.log('当前URL:', page.url());
    await page.screenshot({ path: '.temp/test-01-homepage.png' });
    console.log('截图: .temp/test-01-homepage.png');
    
    // 测试2: 登录页面
    console.log('\n=== 测试2: 导航到登录页面 ===');
    await page.goto('http://localhost:5173/login', { waitUntil: 'networkidle', timeout: 30000 });
    console.log('当前URL:', page.url());
    await page.screenshot({ path: '.temp/test-02-login.png' });
    console.log('截图: .temp/test-02-login.png');
    
    // 检查登录表单
    const usernameInput = await page.$('input[type="text"], input[name="username"], input[placeholder*="用户名"], input[placeholder*="username"]');
    const passwordInput = await page.$('input[type="password"]');
    console.log('用户名输入框:', usernameInput ? '存在' : '不存在');
    console.log('密码输入框:', passwordInput ? '存在' : '不存在');
    
    if (usernameInput && passwordInput) {
      // 填写登录信息 - 使用管理员账户
      console.log('\n填写登录信息...');
      await usernameInput.fill('admin');
      await passwordInput.fill('admin123');
      
      // 点击登录按钮
      const loginBtn = await page.$('button[type="submit"], button:has-text("登录"), button:has-text("Login")');
      if (loginBtn) {
        console.log('点击登录按钮...');
        await loginBtn.click();
        await page.waitForTimeout(3000);
        console.log('登录后URL:', page.url());
        await page.screenshot({ path: '.temp/test-03-after-login.png' });
        console.log('截图: .temp/test-03-after-login.png');
      }
    }
    
    // 测试3: 管理员模型页面
    console.log('\n=== 测试3: 导航到管理员模型页面 ===');
    await page.goto('http://localhost:5173/admin/models', { waitUntil: 'networkidle', timeout: 30000 });
    console.log('当前URL:', page.url());
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '.temp/test-04-admin-models.png', fullPage: true });
    console.log('截图: .temp/test-04-admin-models.png');
    
    // 检查表格是否存在
    const table = await page.$('table, [role="table"], .MuiTable-root');
    console.log('表格存在:', table ? '是' : '否');
    
    // 检查分类列
    const categoryHeader = await page.$('th:has-text("分类"), th:has-text("Category")');
    console.log('分类列标题存在:', categoryHeader ? '是' : '否');
    
    // 检查创建模型按钮
    const createBtn = await page.$('button:has-text("创建"), button:has-text("Create"), button:has-text("添加"), button:has-text("Add")');
    console.log('创建模型按钮存在:', createBtn ? '是' : '否');
    
    if (createBtn) {
      console.log('\n点击创建模型按钮...');
      await createBtn.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: '.temp/test-05-create-dialog.png' });
      console.log('截图: .temp/test-05-create-dialog.png');
      
      // 检查分类下拉框
      const modelTypeSelect = await page.$('select, .MuiSelect-root, [role="combobox"]');
      console.log('分类下拉框存在:', modelTypeSelect ? '是' : '否');
      
      // 检查是否有 Text, Image, Video 等选项
      const selectOptions = await page.$$('li, option, [role="option"]');
      console.log('下拉选项数量:', selectOptions.length);
      
      // 关闭对话框
      const closeBtn = await page.$('button[aria-label="close"], button:has-text("取消"), button:has-text("Cancel")');
      if (closeBtn) {
        await closeBtn.click();
        await page.waitForTimeout(500);
      }
    }
    
    // 测试4: Action广场页面
    console.log('\n=== 测试4: 导航到Action广场页面 ===');
    await page.goto('http://localhost:5173/actions/marketplace', { waitUntil: 'networkidle', timeout: 30000 });
    console.log('当前URL:', page.url());
    await page.waitForTimeout(2000);
    await page.screenshot({ path: '.temp/test-06-marketplace.png', fullPage: true });
    console.log('截图: .temp/test-06-marketplace.png');
    
    // 检查是否有action卡片
    const actionCards = await page.$$('[class*="card"], [class*="Card"], .MuiCard-root');
    console.log('Action卡片数量:', actionCards.length);
    
    // 检查是否有详情按钮
    const detailBtn = await page.$('button:has-text("详情"), button:has-text("Details"), button:has-text("查看")');
    console.log('详情按钮存在:', detailBtn ? '是' : '否');
    
    if (detailBtn) {
      console.log('\n点击详情按钮...');
      await detailBtn.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: '.temp/test-07-action-detail.png' });
      console.log('截图: .temp/test-07-action-detail.png');
      
      // 检查Action ID显示
      const actionId = await page.$(':text("Action ID"), :text("ID"), [class*="id"]');
      console.log('Action ID区域存在:', actionId ? '是' : '否');
      
      // 检查复制按钮
      const copyBtn = await page.$('button:has-text("复制"), button:has-text("Copy"), [aria-label*="copy"], [aria-label*="复制"]');
      console.log('复制按钮存在:', copyBtn ? '是' : '否');
    }
    
    // 输出控制台消息
    console.log('\n=== 控制台消息 ===');
    const errorMessages = consoleMessages.filter(m => m.type === 'error');
    const warnMessages = consoleMessages.filter(m => m.type === 'warning');
    
    if (errorMessages.length > 0) {
      console.log('错误消息 (' + errorMessages.length + '):');
      errorMessages.forEach(m => console.log('  [ERROR]', m.text));
    } else {
      console.log('错误消息: 无');
    }
    
    if (warnMessages.length > 0) {
      console.log('警告消息 (' + warnMessages.length + '):');
      warnMessages.forEach(m => console.log('  [WARN]', m.text));
    } else {
      console.log('警告消息: 无');
    }
    
    if (errors.length > 0) {
      console.log('\n页面错误:');
      errors.forEach(e => console.log('  ', e));
    }
    
  } catch (err) {
    console.error('测试错误:', err.message);
    await page.screenshot({ path: '.temp/test-error.png' });
  }
  
  await browser.close();
  console.log('\n测试完成!');
}

test().catch(console.error);
