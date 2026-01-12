# المساهمة في نظام الطيران المتكامل (AIS)
# Contributing to AIS Aviation System

[العربية](#العربية) | [English](#english)

---

## العربية

### هل المستودع عام؟

يمكنك التحقق من حالة المستودع (عام أو خاص) بالطرق التالية:

1. **عبر واجهة GitHub:**
   - افتح المستودع على GitHub: https://github.com/kafaat/ais-aviation-system
   - إذا كان المستودع عام، سترى شارة "Public" بجانب اسم المستودع
   - إذا كان المستودع خاص، سترى شارة "Private"

2. **عبر سطر الأوامر:**
   ```bash
   # باستخدام GitHub CLI
   gh repo view kafaat/ais-aviation-system --json visibility
   ```

### كيفية جعل المستودع عام

إذا كنت **مالك المستودع** أو لديك صلاحيات المسؤول، يمكنك جعل المستودع عام باتباع الخطوات التالية:

#### الطريقة 1: عبر واجهة GitHub

1. **افتح المستودع** على GitHub
2. انتقل إلى **Settings** (الإعدادات)
3. قم بالتمرير لأسفل إلى قسم **Danger Zone** (المنطقة الخطرة)
4. ابحث عن **Change repository visibility** (تغيير رؤية المستودع)
5. اضغط على **Change visibility** (تغيير الرؤية)
6. اختر **Make public** (جعل المستودع عام)
7. **تحذير:** ستحتاج إلى تأكيد الإجراء بكتابة اسم المستودع
8. اضغط على **I understand, change repository visibility** (أفهم، قم بتغيير رؤية المستودع)

#### الطريقة 2: عبر GitHub CLI

```bash
# تأكد من تسجيل الدخول
gh auth login

# تغيير رؤية المستودع إلى عام
gh repo edit kafaat/ais-aviation-system --visibility public
```

#### ⚠️ تحذيرات مهمة قبل جعل المستودع عام

قبل جعل المستودع عام، تأكد من:

1. **إزالة المعلومات الحساسة:**
   - مفاتيح API
   - كلمات المرور
   - بيانات الاعتماد
   - المعلومات الشخصية
   - ملفات `.env` (يجب أن تكون في `.gitignore`)

2. **مراجعة سجل الالتزامات (Git History):**
   ```bash
   # فحص السجل للبحث عن معلومات حساسة
   git log --all --full-history -- "*.env"
   git log -p --all -S "password"
   ```

3. **التأكد من وجود ملف `.gitignore` صحيح:**
   ```bash
   # تحقق من أن الملفات الحساسة مستثناة
   cat .gitignore
   ```

4. **مراجعة الترخيص:**
   - تأكد من وجود ملف `LICENSE` مناسب (المستودع الحالي يستخدم MIT License)

### المساهمة في المشروع

نرحب بالمساهمات! يرجى اتباع الإرشادات التالية:

#### 1. تهيئة بيئة التطوير

```bash
# استنساخ المستودع
git clone https://github.com/kafaat/ais-aviation-system.git
cd ais-aviation-system

# تثبيت الحزم
pnpm install

# نسخ ملف البيئة
cp .env.example .env
# قم بتعديل .env بالإعدادات المناسبة

# تطبيق migrations لقاعدة البيانات
pnpm db:push

# إضافة بيانات تجريبية
npx tsx scripts/seed-data.mjs
```

#### 2. تشغيل المشروع

```bash
# تشغيل في وضع التطوير
pnpm dev

# الوصول إلى التطبيق
# Frontend: http://localhost:3000
# Backend: http://localhost:3000/api
```

#### 3. تشغيل الاختبارات

```bash
# تشغيل جميع الاختبارات
pnpm test

# تشغيل الاختبارات في وضع المراقبة
pnpm test:watch

# تشغيل اختبارات E2E
pnpm test:e2e
```

#### 4. إنشاء Pull Request

1. أنشئ فرع جديد للميزة أو الإصلاح:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. قم بالتعديلات والالتزامات:
   ```bash
   git add .
   git commit -m "وصف واضح للتغييرات"
   ```

3. ادفع التغييرات:
   ```bash
   git push origin feature/your-feature-name
   ```

4. افتح Pull Request على GitHub

#### 5. معايير الكود

- **TypeScript:** استخدم الكتابة القوية وتجنب `any`
- **التنسيق:** استخدم Prettier للتنسيق (`pnpm format`)
- **الاختبارات:** أضف اختبارات للميزات الجديدة
- **التوثيق:** حدّث الوثائق عند الحاجة
- **الالتزامات:** استخدم رسائل التزام واضحة وذات معنى

### الدعم

للحصول على المساعدة:
- افتح [issue على GitHub](https://github.com/kafaat/ais-aviation-system/issues)
- راجع [دليل المطور](docs/DEVELOPER_GUIDE.md)
- راجع [دليل استكشاف الأخطاء](docs/TROUBLESHOOTING.md)

---

## English

### Is the Repository Public?

You can check if the repository is public or private by:

1. **Via GitHub Web Interface:**
   - Open the repository on GitHub: https://github.com/kafaat/ais-aviation-system
   - If the repository is public, you'll see a "Public" badge next to the repository name
   - If the repository is private, you'll see a "Private" badge

2. **Via Command Line:**
   ```bash
   # Using GitHub CLI
   gh repo view kafaat/ais-aviation-system --json visibility
   ```

### How to Make the Repository Public

If you are the **repository owner** or have admin permissions, you can make the repository public by following these steps:

#### Method 1: Via GitHub Web Interface

1. **Open the repository** on GitHub
2. Go to **Settings**
3. Scroll down to the **Danger Zone** section
4. Find **Change repository visibility**
5. Click **Change visibility**
6. Select **Make public**
7. **Warning:** You'll need to confirm the action by typing the repository name
8. Click **I understand, change repository visibility**

#### Method 2: Via GitHub CLI

```bash
# Ensure you're logged in
gh auth login

# Change repository visibility to public
gh repo edit kafaat/ais-aviation-system --visibility public
```

#### ⚠️ Important Warnings Before Making Repository Public

Before making the repository public, ensure you:

1. **Remove sensitive information:**
   - API keys
   - Passwords
   - Credentials
   - Personal information
   - `.env` files (should be in `.gitignore`)

2. **Review Git History:**
   ```bash
   # Check history for sensitive information
   git log --all --full-history -- "*.env"
   git log -p --all -S "password"
   ```

3. **Ensure proper `.gitignore`:**
   ```bash
   # Verify sensitive files are excluded
   cat .gitignore
   ```

4. **Review License:**
   - Ensure you have an appropriate `LICENSE` file (current repository uses MIT License)

### Contributing to the Project

We welcome contributions! Please follow these guidelines:

#### 1. Setup Development Environment

```bash
# Clone the repository
git clone https://github.com/kafaat/ais-aviation-system.git
cd ais-aviation-system

# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env
# Edit .env with appropriate settings

# Apply database migrations
pnpm db:push

# Seed test data
npx tsx scripts/seed-data.mjs
```

#### 2. Run the Project

```bash
# Run in development mode
pnpm dev

# Access the application
# Frontend: http://localhost:3000
# Backend: http://localhost:3000/api
```

#### 3. Run Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run E2E tests
pnpm test:e2e
```

#### 4. Create a Pull Request

1. Create a new branch for your feature or fix:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make changes and commit:
   ```bash
   git add .
   git commit -m "Clear description of changes"
   ```

3. Push changes:
   ```bash
   git push origin feature/your-feature-name
   ```

4. Open a Pull Request on GitHub

#### 5. Code Standards

- **TypeScript:** Use strong typing, avoid `any`
- **Formatting:** Use Prettier for formatting (`pnpm format`)
- **Tests:** Add tests for new features
- **Documentation:** Update documentation when needed
- **Commits:** Use clear and meaningful commit messages

### Support

For help:
- Open an [issue on GitHub](https://github.com/kafaat/ais-aviation-system/issues)
- Review the [Developer Guide](docs/DEVELOPER_GUIDE.md)
- Review the [Troubleshooting Guide](docs/TROUBLESHOOTING.md)

---

## License

This project is licensed under the MIT License - see the LICENSE file for details.
