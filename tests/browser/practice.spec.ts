import {test,expect} from '@playwright/test';
test('3D rendering, actual movement, mouse camera, pause, seek and retry',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.locator('#scene canvas')).toBeVisible();await expect(page.locator('#raid .raid-cell')).toHaveCount(20);
 await page.locator('#begin').click();await expect(page.locator('#play')).toHaveText('Ⅱ 일시정지');
 const before=await page.evaluate(()=>(window as any).raidDebug.sim.player.z);
 await page.keyboard.down('KeyW');await page.waitForTimeout(800);await page.keyboard.up('KeyW');
 const after=await page.evaluate(()=>(window as any).raidDebug.sim.player.z);expect(Math.abs(after-before)).toBeGreaterThan(1);
 const box=(await page.locator('#scene').boundingBox())!;await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down({button:'right'});await page.mouse.move(box.x+box.width/2+120,box.y+box.height/2+20,{steps:10});await page.mouse.up({button:'right'});
 await page.locator('#play').click();const t=await page.evaluate(()=>(window as any).raidDebug.sim.time);await page.waitForTimeout(250);expect(await page.evaluate(()=>(window as any).raidDebug.sim.time)).toBe(t);
 await page.locator('[data-practice="92"]').click();await expect(page.locator('#clock')).toHaveText('01:32');expect(await page.evaluate(()=>(window as any).raidDebug.sim.results.length)).toBe(0);
 await page.locator('#retry').click();await expect(page.locator('#clock')).toHaveText('01:32');
 await page.locator('#results-open').click();await expect(page.locator('#results')).toBeVisible();await page.locator('#results .close').click();
 await page.locator('#sources-open').click();await expect(page.locator('#source-events tr')).toHaveCount(41);await page.locator('#sources .close').click();
 expect(errors).toEqual([]);
 await page.screenshot({path:'/tmp/raid-practice-desktop.png',fullPage:true});
});
test('role settings, keyboard focus, blur pause and preserved scenario export',async({page})=>{
 await page.goto('/');await page.locator('[data-role="healer"]').click();await page.locator('#position').selectOption('melee');await page.locator('#party').selectOption('4');await page.locator('#soak').selectOption('2');await page.locator('#bait').selectOption('true');await page.locator('#apply').click();
 expect(await page.evaluate(()=>(window as any).raidDebug.sim.player.role)).toBe('healer');expect(await page.evaluate(()=>(window as any).raidDebug.sim.player.position)).toBe('melee');
 await page.locator('#play').click();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await expect(page.locator('#play')).toHaveText('▶ 계속');
 const before=await page.evaluate(()=>(window as any).raidDebug.sim.player.x);await page.locator('#seed').focus();await page.keyboard.press('KeyW');await page.waitForTimeout(200);expect(await page.evaluate(()=>(window as any).raidDebug.sim.player.x)).toBe(before);
 const download=page.waitForEvent('download');await page.locator('#export').click();const file=await download;expect(file.suggestedFilename()).toMatch(/raid-practice/);
 await page.reload();expect(await page.evaluate(()=>(window as any).raidDebug.sim.config.bait)).toBe(true);
});
test('all encounter segments finish with actual simulation results, no runtime errors',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await expect(page.locator('#scene canvas')).toBeVisible();
 await page.evaluate(()=>(window as any).raidDebug.step(19000));expect(await page.evaluate(()=>(window as any).raidDebug.sim.completed)).toBe(true);expect(await page.evaluate(()=>(window as any).raidDebug.sim.results.length)).toBeGreaterThan(20);await expect(page.locator('#phase')).toHaveText('연습 종료');expect(errors).toEqual([]);
});
