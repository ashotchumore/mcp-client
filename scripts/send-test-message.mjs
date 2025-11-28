import { chromium } from 'playwright';

async function sendTestMessage() {
  console.log('🚀 브라우저를 실행합니다...');
  
  const browser = await chromium.launch({ 
    headless: false,  // 브라우저 창을 볼 수 있도록 설정
    slowMo: 200       // 동작을 천천히 하여 확인 가능
  });
  
  const context = await browser.newContext();
  const page = await context.newPage();
  
  try {
    console.log('📍 http://localhost:3000 으로 이동합니다...');
    await page.goto('http://localhost:3000');
    
    // 페이지 로딩 대기
    await page.waitForLoadState('networkidle');
    console.log('✅ 페이지 로딩 완료');
    
    // 입력창 찾기
    const textarea = page.locator('textarea');
    await textarea.waitFor({ state: 'visible', timeout: 10000 });
    console.log('✅ 입력창 발견');
    
    // 테스트 메시지 입력
    const testMessage = '안녕하세요! 이것은 Playwright로 자동 전송된 테스트 메시지입니다. 🤖';
    console.log(`📝 메시지 입력: "${testMessage}"`);
    await textarea.fill(testMessage);
    
    // 전송 버튼 클릭
    const sendButton = page.locator('button[type="submit"]');
    await sendButton.click();
    console.log('📤 메시지 전송 버튼 클릭');
    
    // AI 응답 대기
    console.log('⏳ AI 응답 대기 중...');
    
    // 모델 응답 메시지가 나타나고 내용이 채워질 때까지 대기
    // 최소 하나의 모델 응답 버블이 나타날 때까지 대기
    await page.waitForTimeout(1000);
    
    // 응답 내용이 있는 메시지 버블 대기 (최대 20초)
    let attempts = 0;
    const maxAttempts = 40;
    while (attempts < maxAttempts) {
      const messages = await page.locator('.justify-start .rounded-lg').all();
      if (messages.length > 0) {
        const lastMessage = messages[messages.length - 1];
        const text = await lastMessage.textContent();
        // "..." 가 아닌 실제 내용이 있으면 응답 완료
        if (text && text.trim() !== '...' && text.length > 10) {
          console.log('✅ AI 응답 수신 완료!');
          console.log(`💬 응답 미리보기: "${text.slice(0, 100)}..."`);
          break;
        }
      }
      await page.waitForTimeout(500);
      attempts++;
    }
    
    // 결과 스크린샷 저장
    await page.screenshot({ path: 'scripts/test-result.png', fullPage: true });
    console.log('📸 스크린샷 저장: scripts/test-result.png');
    
    // 잠시 대기하여 결과 확인
    await page.waitForTimeout(2000);
    
    console.log('🎉 테스트 완료!');
    
  } catch (error) {
    console.error('❌ 에러 발생:', error.message);
    await page.screenshot({ path: 'scripts/error-screenshot.png' });
  } finally {
    await browser.close();
    console.log('🔒 브라우저 종료');
  }
}

sendTestMessage();

