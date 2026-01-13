# AIS Aviation System – Developer Runbook (مختصر)

خطوات أساسية:

1. تشغيل مهاجرات Drizzle بعد إضافة الجداول:
   - flights / flight_instances / seat_inventory
   - loyalty_accounts / loyalty_transactions
   - seat_maps / seat_map_seats / flight_instance_seats
   - notifications

2. تشغيل السيرفر والفرونت:
   - npm run server
   - npm run dev

3. التأكد من:
   - /admin/flights تعمل للـ CRUD
   - /account/loyalty تعرض رصيد النقاط والحركات
   - /account/my-trips تعرض الحجوزات والمقاعد
   - NotificationBell تستقبل إشعارات بعد الحجز
