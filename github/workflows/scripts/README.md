# NursePulse

เว็บแอประบบกลางตอบแบบสอบถามภารกิจด้านการพยาบาลแบบ responsive. เปิด `index.html` ได้ทันทีเพื่อดูต้นแบบและทดสอบ flow ในเบราว์เซอร์ (ตั้ง `demoMode: true` ใน `config.js` หากต้องการลองหน้าแอดมินโดยยังไม่เชื่อม Supabase)

## สิ่งที่มีในต้นแบบ

- ค้นหาบุคลากร/เพิ่มชื่อด้วยตนเอง, dashboard แยกตามกลุ่มเป้าหมายและสถานะ
- ฟอร์มคำตอบพร้อมบันทึกร่างในเครื่อง และการส่งคำตอบ
- หน้าแอดมิน: รายการแบบสอบถาม, form builder, CSV template/import, dashboard รายงาน และ export CSV ที่เปิดด้วย Excel ได้
- ไม่มีรหัสผู้ดูแลอยู่ในโค้ด client. หน้าล็อกอินแอดมินในต้นแบบเป็น placeholder เพื่อทดสอบ UI เท่านั้น

## เชื่อมต่อ Supabase ก่อนใช้งานจริง

1. เปิด SQL Editor ของโปรเจกต์ Supabase แล้วรัน [`supabase/schema.sql`](supabase/schema.sql)
2. สร้าง Edge Function `verify-admin` จากโค้ดที่ [`supabase/functions/verify-admin/index.ts`](supabase/functions/verify-admin/index.ts) แล้วเก็บรหัสผู้ดูแลเป็น secret ของ Supabase (`supabase secrets set ADMIN_PASSWORD=11450`) ไม่ใช่ในไฟล์เว็บ
3. ใช้ Supabase Auth หรือออก signed session จาก Edge Function ก่อนเปิด RLS policies. ห้ามใช้ service-role key ใน browser
4. แทนที่ demo/localStorage ใน `app.js` ด้วย Supabase queries และกำหนด RLS policies ตามวิธี authentication ที่เลือก

> ระบบ anonymous ต้อง insert `survey_responses.user_id = null` เสมอ และบันทึกการกันตอบซ้ำไว้ใน `anonymous_submission_log` แยกจากคำตอบโดยเด็ดขาด.
