/**
 * 丈量預約單 - 選材網站 & 一次性保固查詢 API (支援多筆明細)
 */

const express = require('express');
const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const BIZFORM_BASE = 'https://bizform.vitalyun.com/backend/api';
const API_KEY = process.env.BIZFORM_API_KEY;

// === 1. 丈量預約單設定 ===
const FORM_ID = 16;
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

// === 2. 驗收單(保固查詢)設定 ===
const ACCEPTANCE_FORM_ID = 19; 
const ACCEPTANCE_PHONE_FIELD_NAME = 'c113f953d306439fa6da7a782566d8f7'; // 聯絡電話

// 我從你的 json 幫你找出來的明細表真實 ID
const ACCEPTANCE_GRID_FIELD_ID = 'field_41'; 

// 明細表由左至右的欄位索引 (Index)
// 0: 項次(field_42) | 1: 驗收項目(field_43) | 2: 驗收結果(field_44) | 3: 保固日期(field_45)
const COL_INDEX_ITEM_NAME = 1; 
const COL_INDEX_WARRANTY_DATE = 3; 

// =========================================================
// API 1: 寫入丈量預約單 (你原本寫的功能，完整保留)
// =========================================================
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

// =========================================================
// API 2: 依電話查詢最新驗收單，回傳格式化保固字串 (支援多個項目)
// 用法：GET /api/warranty-end-date?phone=0901181123
// =========================================================
app.get('/api/warranty-end-date', async (req, res) => {
  try {
    const phone = req.query.phone;
    if (!phone) return res.status(400).json({ error: '請提供 phone 參數' });

    // 1. 查詢最新一筆該電話的驗收單
    const queryBody = {
      formId: ACCEPTANCE_FORM_ID,
      attributes: [{ key: ACCEPTANCE_PHONE_FIELD_NAME, value: phone }],
      pageIndex: 1,
      pageSize: 1, // 抓最新一筆
      includeAttributes: true,
      sorting: 0,
      desc: true,
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

    if (!bizRes.ok) return res.status(502).json({ error: '查詢失敗' });

    const docs = await bizRes.json();
    if (!Array.isArray(docs) || docs.length === 0) {
      return res.status(404).json({ error: '找不到該電話的保固資料' });
    }

    const latestDoc = docs[0];

    // 2. 抓取 field_41 明細表資料
    const gridAttr = (latestDoc.attributes || []).find(a => a.id === ACCEPTANCE_GRID_FIELD_ID);
    
    let warrantyText = "查無保固明細";

    // 3. 解析明細表並組裝字串
    if (gridAttr && gridAttr.value && gridAttr.value.length > 0) {
      try {
        // 解析 BizForm 傳回來的 2D 陣列
        const rows = typeof gridAttr.value[0] === 'string' ? JSON.parse(gridAttr.value[0]) : gridAttr.value[0];
        
        let itemsList = [];
        for (let row of rows) {
          if (!row || row.length === 0) continue; 
          
          const itemName = row[COL_INDEX_ITEM_NAME];
          const date = row[COL_INDEX_WARRANTY_DATE];
          
          // 只要名稱跟日期有值，就組合成一句話
          if (itemName && date) {
            itemsList.push(`${itemName}的保固到期日: ${date}`);
          }
        }
        
        // 如果有抓到資料，就加上中括號
        if (itemsList.length > 0) {
          warrantyText = `[${itemsList.join('， ')}]`;
        }
      } catch (e) {
        console.error("解析明細表失敗:", e);
        warrantyText = "解析保固資料發生錯誤";
      }
    }

    // 4. 回傳給 C.ai
    res.json({
      phone,
      documentId: latestDoc.id,
      warrantyText: warrantyText
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on :${PORT}`));
