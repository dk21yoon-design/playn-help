import asyncio,sys
from playwright.async_api import async_playwright
async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome' if False else None)
    pg=await b.new_page(viewport={'width':1080,'height':1350},device_scale_factor=1)
    await pg.goto('file://'+sys.argv[1]); await pg.wait_for_timeout(1500)
    print(await pg.evaluate("document.fonts.check('40px Pretendard')"), await pg.evaluate("document.fonts.check('40px Jalnan')"))
    for i in range(1,6):
      await (await pg.query_selector(f'#c{i}')).screenshot(path=f'W08v2_0{i}.png')
    await b.close()
asyncio.run(main())
