/**
 * 丈量預約單 - 選材網站
 * 客戶瀏覽衛浴商品 -> 選材(可複選) -> 填寫聯絡資料 -> 一次送出
 * 寫入 BizForm「丈量預約單範本」表單（form.id=16）
 *
 * 注意：這張表單屬於不同的站台（depotId=d6dec2f63f1c47ec8e10af11e808a559），
 * 跟花藝/壽衣不是同一組，請確認您的 x-api-key 是否對這個站台有效，
 * 若無效需要另外申請這個站台專用的 API Key。
 */

const express = require('express');
const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const BIZFORM_BASE = 'https://bizform.vitalyun.com/backend/api';
const API_KEY = process.env.BIZFORM_API_KEY;
const FORM_ID = 16;

// 各欄位真正的 id（field_N，來自表單 GET 回傳的 attributes）
const FIELD_IDS = {
  address: 'field_5',    // 丈量地址
  custName: 'field_7',   // 客戶姓名
  phone: 'field_8',      // 聯絡電話
  space: 'field_22',     // 裝修空間
  date: 'field_28',      // 希望丈量日期
  need: 'field_30',      // 裝修需求
  timeslot: 'field_33',  // 希望丈量時段
  material: 'field_34',  // 選材編號
  note: 'field_35',      // 備註
  email: 'field_36',     // 電子郵件
};

app.post('/api/submit', async (req, res) => {
  try {
    const { name, phone, email, address, date, timeslot, space, need, note, materialCodes } = req.body;
    if (!name || !phone || !email || !address) {
      return res.status(400).json({ error: '請填寫所有必填欄位' });
    }

    const now = new Date().toISOString();

    const attributes = [
      { id: FIELD_IDS.address, value: [address] },
      { id: FIELD_IDS.custName, value: [name] },
      { id: FIELD_IDS.phone, value: [phone] },
      { id: FIELD_IDS.email, value: [email] },
      { id: FIELD_IDS.material, value: [materialCodes || ''] },
      { id: FIELD_IDS.date, value: [date || ''] },
      { id: FIELD_IDS.timeslot, value: [timeslot || ''] },
      { id: FIELD_IDS.space, value: [space || ''] },
      { id: FIELD_IDS.need, value: [need || ''] },
      { id: FIELD_IDS.note, value: [note || ''] },
    ];

    const body = {
      id: 0,
      form: { id: FORM_ID },
      title: phone,
      summary: address,
      attributes,
      attachments: [],
      categories: [],
      tags: [],
      creationDateTime: now,
      versionCreationDateTime: now,
      permissions: [],
      notificationSetting: { onDocumentCreated: [], onWorkflowCompleted: [] },
      owner: null,
      versionCreator: null,
      versionNumber: 1,
      subDocuments: [],
      state: 0,
      executedDateTime: now,
      lastAuditor: null,
    };

    const bizRes = await fetch(`${BIZFORM_BASE}/Documents`, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!bizRes.ok) {
      const text = await bizRes.text();
      console.error('BizForm create error:', bizRes.status, text);
      return res.status(502).json({ error: '寫入表單失敗，請稍後再試或聯絡工作人員' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on :${PORT}`));

/**
 * 給 C.ai 用的查詢端點：依客戶電話查詢「驗收單範本」的保固結束日期
 * 用法：GET /api/warranty-end-date?phone=0912345678
 */
const ACCEPTANCE_FORM_ID = 19; // 驗收單範本 form.id
const ACCEPTANCE_PHONE_FIELD_NAME = 'c113f953d306439fa6da7a782566d8f7'; // 聯絡電話欄位的 name(內部識別碼)
const ACCEPTANCE_WARRANTY_END_FIELD_ID = 'field_40'; // 保固結束日期

app.get('/api/warranty-end-date', async (req, res) => {
  try {
    const phone = req.query.phone;
    if (!phone) return res.status(400).json({ error: '請提供 phone 參數' });

    const queryBody = {
      formId: ACCEPTANCE_FORM_ID,
      attributes: [{ key: ACCEPTANCE_PHONE_FIELD_NAME, value: phone }],
      pageIndex: 1,
      pageSize: 10,
      includeAttributes: true,
      sorting: 0, // 依修改時間排序
      desc: true, // 由新到舊，抓最新的一筆
    };

    const bizRes = await fetch(`${BIZFORM_BASE}/Documents/query`, {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(queryBody),
    });

    if (!bizRes.ok) {
      const text = await bizRes.text();
      console.error('查詢驗收單失敗:', bizRes.status, text);
      return res.status(502).json({ error: '查詢失敗，請稍後再試' });
    }

    const docs = await bizRes.json();
    if (!Array.isArray(docs) || docs.length === 0) {
      return res.status(404).json({ error: '找不到符合這個電話的驗收單資料' });
    }

    // 取最新一筆
    const doc = docs[0];
    const attr = (doc.attributes || []).find(a => a.id === ACCEPTANCE_WARRANTY_END_FIELD_ID);
    const warrantyEndDate = attr && attr.value && attr.value[0] ? attr.value[0] : null;

    res.json({
      phone,
      documentId: doc.id,
      warrantyEndDate,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});
