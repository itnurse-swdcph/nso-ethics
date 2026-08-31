# Implementation Plan: ระบบกลางตอบแบบสอบถามภารกิจด้านการพยาบาล

## 1. ภาพรวมระบบ (System Overview)

ระบบเว็บแอปพลิเคชันกลางสำหรับรวบรวมและจัดการแบบสอบถามของภารกิจด้านการพยาบาล คล้าย Google Forms แต่ปรับให้เหมาะกับโครงสร้างองค์กรพยาบาล มี 2 บทบาทหลัก:

- **แอดมิน** — สร้าง/จัดการแบบสอบถาม กำหนดกลุ่มเป้าหมาย ดูรายงานสรุปและส่งออกข้อมูล
- **ผู้ใช้ (บุคลากร)** — ค้นหาตัวเองเข้าระบบ ตอบแบบสอบถามที่ตรงกับตำแหน่ง/ระดับของตน

**เป้าหมายเชิงคุณภาพ:** ใช้งานง่าย ทันสมัย รองรับมือถือ (Responsive) ปลอดภัย และรองรับแบบสอบถามแบบไม่เปิดเผยตัวตนได้จริง

---

## 2. Tech Stack ที่แนะนำ

| ส่วน | เทคโนโลยี | เหตุผล |
|---|---|---|
| Frontend | React (Next.js) + Tailwind CSS + shadcn/ui | พัฒนาไว รองรับ Responsive และ UI สวยงามได้มาตรฐาน |
| Backend / DB | Supabase (Postgres + Auth + Storage + RLS) | ตามที่กำหนด รองรับ Row Level Security เพื่อควบคุมสิทธิ์ข้อมูลแยกตามบทบาท |
| Excel/CSV | `xlsx` (SheetJS) สำหรับ export/template, `papaparse` สำหรับ import CSV | อ่าน/เขียนไฟล์ฝั่ง client หรือผ่าน Edge Function |
| กราฟแดชบอร์ด | Recharts หรือ Chart.js | สรุปผลแบบสอบถามเป็นภาพ |
| Hosting | Vercel / Netlify (frontend) + Supabase Cloud | Deploy ง่าย รองรับ CI/CD |

---

## 3. โครงสร้างฐานข้อมูล (Supabase Schema)

### 3.1 ตารางหลัก

**`departments`** (หน่วยงาน)
- `id` (uuid, PK)
- `name` (text)

**`users`** (บุคลากร — ไม่ใช้ Supabase Auth เต็มรูปแบบ เพราะ login ด้วยการค้นชื่อ)
- `id` (uuid, PK)
- `full_name` (text)
- `position` (text) — พยาบาลวิชาชีพ / พนักงานช่วยเหลือคนไข้ / พนักงานประจำตึก / อื่นๆ (ระบุ)
- `level` (enum: `head_of_group`, `head_of_unit`, `practitioner`) — หัวหน้ากลุ่มงาน / หัวหน้างาน / ผู้ปฏิบัติ
- `department_id` (uuid, FK → departments)
- `created_at`, `is_self_registered` (bool — เพิ่มเองตอนหาไม่เจอ, ใช้ flag ให้แอดมินตรวจสอบย้อนหลังได้)

**`surveys`** (แบบสอบถาม)
- `id` (uuid, PK)
- `title` (text)
- `description` (text) — คำชี้แจงแบบสอบถาม
- `is_anonymous` (bool) — true = ไม่เก็บชื่อผู้ตอบ
- `status` (enum: `draft`, `published`, `closed`)
- `created_by`, `created_at`, `published_at`, `closes_at` (nullable)

**`survey_target_levels`** (กลุ่มเป้าหมายที่เลือกได้หลายค่า)
- `survey_id` (FK), `level` (enum เดียวกับ users.level) — many-to-many

**`survey_questions`**
- `id` (uuid, PK)
- `survey_id` (FK)
- `order_index` (int)
- `question_text` (text)
- `question_type` (enum: `short_text`, `long_text`, `single_choice`, `multiple_choice`, `rating_scale`, `dropdown`, `date`, `number`)
- `is_required` (bool)

**`question_options`** (สำหรับ choice/dropdown/rating)
- `id`, `question_id` (FK), `option_text`, `order_index`

**`survey_responses`** (1 แถว = ผู้ตอบ 1 คน 1 แบบสอบถาม)
- `id` (uuid, PK)
- `survey_id` (FK)
- `user_id` (FK, **nullable** — null เมื่อ `is_anonymous = true`)
- `status` (enum: `in_progress`, `completed`)
- `started_at`, `submitted_at`

**`response_answers`**
- `id`, `response_id` (FK), `question_id` (FK)
- `answer_text` (text) / `answer_option_ids` (uuid[]) — เก็บได้ทั้งข้อความและตัวเลือก

### 3.2 หลักการสำคัญเรื่องความไม่เปิดเผยตัวตน
เมื่อ `surveys.is_anonymous = true` ระบบ **จะไม่บันทึก `user_id` ลงใน `survey_responses` เลย** (ไม่ใช่แค่ซ่อนในหน้าจอ) เพื่อไม่ให้ข้อมูลตัวตนหลุดในชั้นฐานข้อมูล — แต่ระบบยังคง track "ใครตอบไปแล้ว" แยกในตาราง `anonymous_submission_log (user_id, survey_id, submitted_at)` ที่ **แยกออกจากคำตอบจริง** เพื่อกันตอบซ้ำ โดยไม่ผูกกับ `response_answers`

### 3.3 Row Level Security (RLS) แนวทาง
- แอดมิน: bypass ผ่าน service role (เก็บรหัสแอดมินไว้ฝั่ง server/Edge Function เท่านั้น ห้าม expose ใน client bundle)
- ผู้ใช้ทั่วไป: เห็นเฉพาะแบบสอบถามที่ `survey_target_levels` ตรงกับ `level` ของตน และแก้ไขได้เฉพาะ response ของตัวเอง

---

## 4. ฟีเจอร์ฝั่งแอดมิน

### 4.1 การเข้าสู่ระบบแอดมิน
- หน้า Login แยกจากผู้ใช้ทั่วไป กรอกรหัส 4-5 หลัก (11450)
- รหัสตรวจสอบผ่าน **Supabase Edge Function** (server-side) ไม่ฝังในโค้ด frontend และไม่ log ค่า
- เก็บ session เป็น token ชั่วคราว (เช่น JWT อายุสั้น หรือ Supabase custom claim)

### 4.2 สร้าง/แก้ไขแบบสอบถาม (Form Builder)
- ชื่อแบบสอบถาม + คำชี้แจง (rich text หรือ plain text)
- เพิ่มคำถามทีละข้อ เลือกประเภทคำตอบ (ตามชนิดใน `question_type`) พร้อม drag-to-reorder
- ตั้งค่า required/optional ต่อข้อ
- เลือกกลุ่มเป้าหมาย (multi-select: หัวหน้ากลุ่มงาน / หัวหน้างาน / ผู้ปฏิบัติ หรือ "ทั้งหมด")
- Toggle "ระบุตัวตนผู้ตอบ" หรือ "ไม่ระบุตัวตน"
- Preview ก่อน publish, สถานะ draft/published/closed

### 4.3 นำเข้าแบบสอบถามผ่าน CSV/Excel
- ปุ่ม "ดาวน์โหลดเทมเพลต Excel" → ไฟล์ที่มีคอลัมน์: `order, question_text, question_type, options(คั่นด้วย ;), is_required`
- อัปโหลด CSV → parse ด้วย PapaParse → preview ตารางก่อนยืนยันสร้างจริง (กันไฟล์ผิดพลาด)
- ตรวจสอบ validation: ประเภทคำถามต้องตรงกับ enum ที่รองรับ, choice ต้องมี options อย่างน้อย 2 ตัว

### 4.4 หน้าสรุปรายงาน
- ค้นหา/กรองรายการแบบสอบถาม (ชื่อ, สถานะ, ช่วงวันที่)
- คลิกเข้าดูแดชบอร์ดสรุปต่อแบบสอบถาม: จำนวนผู้ตอบ/เป้าหมายทั้งหมด (% completion), กราฟแจกแจงคำตอบแบบ choice/rating, คำตอบปลายเปิดแบบ list
- ปุ่ม "ดาวน์โหลด Excel" export คำตอบละเอียดทุกข้อ (ถ้าเป็นแบบระบุชื่อ จะมีคอลัมน์ชื่อ-ตำแหน่ง-หน่วยงาน; ถ้า anonymous จะไม่มีคอลัมน์ระบุตัวตนเลย)

---

## 5. ฟีเจอร์ฝั่งผู้ใช้

### 5.1 เข้าสู่ระบบ
- หน้าค้นหาชื่อตัวเอง (autocomplete จากตาราง `users`)
- พบชื่อ → กด "เข้าสู่ระบบ" (ไม่ต้องรหัสผ่าน หรือจะเพิ่ม PIN ทีหลังก็ได้)
- ไม่พบชื่อ → ฟอร์มเพิ่มตนเอง (ชื่อ-นามสกุล, ตำแหน่ง, ระดับ, หน่วยงาน) → บันทึกและเข้าสู่ระบบทันที (flag `is_self_registered = true` ให้แอดมินตรวจทีหลัง)

### 5.2 หน้าหลัก (Dashboard ผู้ใช้)
- แสดงชื่อ ตำแหน่ง หน่วยงาน มุมบนของหน้า
- รายการแบบสอบถามเฉพาะกลุ่มเป้าหมายของตน เรียงล่าสุดขึ้นก่อน
- Badge สถานะต่อรายการ: **ตอบแล้ว / ยังไม่ตอบ / ตอบยังไม่เสร็จ**
- ปุ่ม "ตอบแบบสอบถาม" ปรากฏเฉพาะรายการที่ยังไม่เสร็จ (ซ่อนอัตโนมัติเมื่อ completed)

### 5.3 เมนูย่อย (Tabs/Sidebar)
1. แบบสอบถามทั้งหมด
2. รายการที่ทำสำเร็จ
3. แบบสอบถามที่กำลังดำเนินการ (in_progress)
4. รายการที่รอดำเนินการ
5. ตั้งค่าบัญชี (แก้ไขตำแหน่ง/หน่วยงานตนเอง)

### 5.4 หน้าตอบแบบสอบถาม
- แสดงคำชี้แจงก่อนเริ่ม
- Autosave คำตอบระหว่างทำ (สถานะ = in_progress) เพื่อรองรับกรณีตอบไม่เสร็จแล้วออกจากระบบ
- ปุ่มส่งคำตอบ (submit) → เปลี่ยนสถานะเป็น completed และล็อกการแก้ไข (หรือเปิดให้แก้ไขได้ตามนโยบาย)

---

## 6. UX/UI แนวทาง
- Mobile-first, ปุ่มขนาดกดง่ายบนมือถือ, ใช้ shadcn/ui components (Card, Badge, Progress, Tabs)
- สีธีมสุภาพเป็นทางการแบบหน่วยงานสาธารณสุข (โทนฟ้า/เขียวสะอาดตา) พร้อม dark mode ได้ถ้าต้องการ
- Progress bar ระหว่างตอบแบบสอบถามหลายหน้า/หลายข้อ

---

## 7. ความปลอดภัยที่ต้องเน้น
1. รหัสแอดมินไม่ฝังใน client-side code — ตรวจสอบผ่าน Edge Function เท่านั้น
2. RLS บังคับใช้ทุกตาราง ป้องกันผู้ใช้เห็นคำตอบคนอื่น
3. แบบสอบถาม anonymous ต้องไม่มีทาง join กลับไปหาตัวตนได้แม้ในระดับฐานข้อมูล
4. Rate limit การค้นหา/เพิ่มชื่อผู้ใช้ กันสแปม
5. Audit log การกระทำของแอดมิน (สร้าง/แก้ไข/ลบแบบสอบถาม)

---

## 8. แผนการพัฒนา (Phased Roadmap)

| เฟส | ขอบเขต | ระยะเวลาโดยประมาณ |
|---|---|---|
| 1. Foundation | ออกแบบ Schema + Supabase setup + RLS พื้นฐาน + Auth (admin code, user search) | 1 สัปดาห์ |
| 2. Admin Form Builder | สร้าง/แก้ไขแบบสอบถาม, กำหนดกลุ่มเป้าหมาย, toggle anonymous | 1-1.5 สัปดาห์ |
| 3. CSV/Excel Import-Export | เทมเพลตดาวน์โหลด, upload+validate, export รายงาน | 1 สัปดาห์ |
| 4. User Flow | ค้นหา/ล็อกอิน, dashboard, ตอบแบบสอบถาม + autosave | 1-1.5 สัปดาห์ |
| 5. Reporting Dashboard | กราฟสรุป, filter, export Excel รายละเอียด | 1 สัปดาห์ |
| 6. Polish & QA | Responsive ทดสอบมือถือ, security review, UAT กับผู้ใช้จริง | 3-5 วัน |

**รวมประมาณ 5-7 สัปดาห์** (ปรับได้ตามทรัพยากรทีม)

---

## 9. การตัดสินใจที่ยืนยันแล้ว (Confirmed Decisions)

| ประเด็น | มติ | ผลกระทบต่อการออกแบบ |
|---|---|---|
| แก้ไขคำตอบหลัง submit | **อนุญาตให้แก้ไขได้** | สถานะ `completed` ไม่ล็อกฟอร์ม ผู้ใช้กลับเข้าไปแก้ `response_answers` ได้ทุกเมื่อที่แบบสอบถามยังไม่ `closed`; เก็บ `updated_at` เพื่อรู้ว่ามีการแก้ไขล่าสุดเมื่อไร (สำหรับ anonymous ก็แก้ได้ผ่าน `anonymous_submission_log` ที่ผูก user_id ไว้ฝั่งนี้เท่านั้น โดยไม่กระทบความไม่เปิดเผยตัวตนของ `response_answers`) |
| ผู้ใช้ self-registered | **ใช้งานได้ทันที ไม่ต้องรออนุมัติ** | `is_self_registered = true` เป็นเพียง flag ให้แอดมินตรวจสอบย้อนหลังเชิงข้อมูล (data hygiene) เท่านั้น ไม่ block การเข้าใช้งานหรือการตอบแบบสอบถาม |

**ยังไม่ตัดสินใจ (จะใช้ค่า default สำหรับ MVP หากไม่ระบุเพิ่มเติม):**
- ระบบแจ้งเตือน (LINE Notify/Email) — **ค่า default: ยังไม่ทำใน MVP** เพิ่มได้ในเฟสถัดไปโดยไม่กระทบ schema หลัก
- จำนวนผู้ใช้พร้อมกันโดยประมาณ — ใช้ Supabase Free/Pro tier มาตรฐานไปก่อน ปรับ scale ทีหลังได้ตามการใช้งานจริง

---

*เอกสารนี้เป็นแผนแนวคิดระดับสถาปัตยกรรม พร้อมสำหรับนำไปแตกเป็น task/ticket และเริ่มพัฒนาจริงในขั้นถัดไป*
