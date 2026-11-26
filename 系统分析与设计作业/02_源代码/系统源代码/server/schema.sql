-- ============================================================
-- 门店经营助手 · 洋流生活超市（课程模拟店）
-- 数据库模式（SQLite 实现，与报告表 12 / 表 18 / 表 53 一一对应）
-- 命名：表名/字段名用英文，中文只出现在界面与数据字典
-- 通用字段：RecordStatus / CreatedAt / CreatedBy / UpdatedAt / UpdatedBy
-- 单据一律只作废不物理删除：RecordStatus = A（有效）/ V（作废）
-- ============================================================

PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS AuditLog;
DROP TABLE IF EXISTS StockMovement;
DROP TABLE IF EXISTS StockAdjust;
DROP TABLE IF EXISTS StocktakeLine;
DROP TABLE IF EXISTS StocktakePlan;
DROP TABLE IF EXISTS PayRecord;
DROP TABLE IF EXISTS SaleLine;
DROP TABLE IF EXISTS SaleOrder;
DROP TABLE IF EXISTS IncomingInspection;
DROP TABLE IF EXISTS CreditEntry;
DROP TABLE IF EXISTS CreditAccount;
DROP TABLE IF EXISTS FulfilmentLog;
DROP TABLE IF EXISTS OnlineOrderLine;
DROP TABLE IF EXISTS OnlineOrder;
DROP TABLE IF EXISTS PointEntry;
DROP TABLE IF EXISTS Member;
DROP TABLE IF EXISTS Customer;
DROP TABLE IF EXISTS PaymentRecord;
DROP TABLE IF EXISTS AccountPayable;
DROP TABLE IF EXISTS StatementLine;
DROP TABLE IF EXISTS Statement;
DROP TABLE IF EXISTS ExpenseNote;
DROP TABLE IF EXISTS ReturnNote;
DROP TABLE IF EXISTS LossReport;
DROP TABLE IF EXISTS MarkdownPlan;
DROP TABLE IF EXISTS HandlingLine;
DROP TABLE IF EXISTS ExpiryHandling;
DROP TABLE IF EXISTS ReceiptLine;
DROP TABLE IF EXISTS ReceiptNote;
DROP TABLE IF EXISTS PurchaseOrderLine;
DROP TABLE IF EXISTS PurchaseOrder;
DROP TABLE IF EXISTS StockLedger;
DROP TABLE IF EXISTS PurchaseBatch;
DROP TABLE IF EXISTS MarkdownRule;
DROP TABLE IF EXISTS Product;
DROP TABLE IF EXISTS ProductCategory;
DROP TABLE IF EXISTS SettlementTerm;
DROP TABLE IF EXISTS SupplierContact;
DROP TABLE IF EXISTS Supplier;
DROP TABLE IF EXISTS SessionToken;
DROP TABLE IF EXISTS Employee;

-- 1. 员工（表 30）
CREATE TABLE Employee (
  EmployeeID   INTEGER PRIMARY KEY AUTOINCREMENT,
  LoginName    TEXT NOT NULL UNIQUE,
  PasswordHash TEXT NOT NULL,
  Name         TEXT NOT NULL,
  Role         TEXT NOT NULL CHECK (Role IN ('Owner','Stocker','Salesperson','Supplier')),
  Phone        TEXT,
  SupplierID   INTEGER REFERENCES Supplier(SupplierID),
  RecordStatus TEXT NOT NULL DEFAULT 'A' CHECK (RecordStatus IN ('A','V')),
  CreatedAt    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  CreatedBy    INTEGER,
  UpdatedAt    TEXT,
  UpdatedBy    INTEGER
);

CREATE TABLE SessionToken (
  Token      TEXT PRIMARY KEY,
  EmployeeID INTEGER NOT NULL REFERENCES Employee(EmployeeID),
  CreatedAt  TEXT NOT NULL,
  ExpiresAt  TEXT NOT NULL,
  UserAgent  TEXT
);

-- 2. 供应商与结算条款（表 31）
CREATE TABLE Supplier (
  SupplierID   INTEGER PRIMARY KEY AUTOINCREMENT,
  Name         TEXT NOT NULL,
  Contact      TEXT,
  Phone        TEXT,
  Address      TEXT,
  RecordStatus TEXT NOT NULL DEFAULT 'A',
  CreatedAt    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  CreatedBy    INTEGER,
  UpdatedAt    TEXT,
  UpdatedBy    INTEGER
);
CREATE INDEX IX_Supplier_Name ON Supplier(Name);

CREATE TABLE SupplierContact (
  ContactID    INTEGER PRIMARY KEY AUTOINCREMENT,
  SupplierID   INTEGER NOT NULL REFERENCES Supplier(SupplierID),
  Name         TEXT NOT NULL,
  Phone        TEXT,
  WeChat       TEXT,
  EmployeeID   INTEGER REFERENCES Employee(EmployeeID),
  RecordStatus TEXT NOT NULL DEFAULT 'A',
  CreatedAt    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE SettlementTerm (
  TermID               INTEGER PRIMARY KEY AUTOINCREMENT,
  SupplierID           INTEGER NOT NULL REFERENCES Supplier(SupplierID),
  PaymentTermDays      INTEGER NOT NULL DEFAULT 30,
  MaxReturnRatio       REAL NOT NULL DEFAULT 0.02,
  AllowedExpenseTypes  TEXT NOT NULL DEFAULT '陈列费,促销费',
  EffectiveDate        TEXT NOT NULL,
  RecordStatus         TEXT NOT NULL DEFAULT 'A',
  CreatedAt            TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 3. 商品与折价规则（表 32、表 33）
CREATE TABLE ProductCategory (
  CategoryID      INTEGER PRIMARY KEY AUTOINCREMENT,
  CategoryName    TEXT NOT NULL,
  ExpiryWarnRatio REAL NOT NULL DEFAULT 0.34,
  RecordStatus    TEXT NOT NULL DEFAULT 'A',
  CreatedAt       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE Product (
  ProductID    INTEGER PRIMARY KEY AUTOINCREMENT,
  CategoryID   INTEGER NOT NULL REFERENCES ProductCategory(CategoryID),
  Barcode      TEXT NOT NULL UNIQUE,
  ProductName  TEXT NOT NULL,
  Specification TEXT,
  Unit         TEXT NOT NULL DEFAULT '件',
  ShelfLifeDays INTEGER NOT NULL DEFAULT 365,
  ListPrice    REAL NOT NULL CHECK (ListPrice >= 0),
  OnShelfFlag  TEXT NOT NULL DEFAULT 'Y',
  SupplierID   INTEGER REFERENCES Supplier(SupplierID),
  RecordStatus TEXT NOT NULL DEFAULT 'A',
  CreatedAt    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  CreatedBy    INTEGER,
  UpdatedAt    TEXT,
  UpdatedBy    INTEGER
);
CREATE INDEX IX_Product_Category ON Product(CategoryID);
CREATE INDEX IX_Product_Name ON Product(ProductName);

CREATE TABLE MarkdownRule (
  RuleID         INTEGER PRIMARY KEY AUTOINCREMENT,
  CategoryID     INTEGER REFERENCES ProductCategory(CategoryID),
  TriggerTime    TEXT NOT NULL DEFAULT '18:00',
  ShelfLifeBand  TEXT NOT NULL,
  RemainDaysFrom REAL NOT NULL DEFAULT 0,
  RemainDaysTo   REAL NOT NULL DEFAULT 2,
  DiscountRate   REAL NOT NULL CHECK (DiscountRate > 0 AND DiscountRate <= 1),
  EffectiveDate  TEXT NOT NULL,
  RecordStatus   TEXT NOT NULL DEFAULT 'A',
  CreatedAt      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 4. 批次与库存台账（表 34、表 35）
CREATE TABLE PurchaseBatch (
  BatchID       INTEGER PRIMARY KEY AUTOINCREMENT,
  BatchNo       TEXT NOT NULL,
  ProductID     INTEGER NOT NULL REFERENCES Product(ProductID),
  SupplierID    INTEGER REFERENCES Supplier(SupplierID),
  ProductionDate TEXT,
  ShelfLifeDays INTEGER NOT NULL,
  ExpiryDate    TEXT,
  PurchasePrice REAL NOT NULL CHECK (PurchasePrice >= 0),
  ArrivalDate   TEXT NOT NULL,
  RecordStatus  TEXT NOT NULL DEFAULT 'A',
  CreatedAt     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IX_Batch_Product_Expiry ON PurchaseBatch(ProductID, ExpiryDate);
CREATE INDEX IX_Batch_Supplier ON PurchaseBatch(SupplierID);

CREATE TABLE StockLedger (
  LedgerID     INTEGER PRIMARY KEY AUTOINCREMENT,
  ProductID    INTEGER NOT NULL REFERENCES Product(ProductID),
  BatchID      INTEGER NOT NULL REFERENCES PurchaseBatch(BatchID),
  Quantity     REAL NOT NULL DEFAULT 0,
  ReservedQty  REAL NOT NULL DEFAULT 0,
  Location     TEXT,
  UpdatedAt    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  RecordStatus TEXT NOT NULL DEFAULT 'A',
  UNIQUE (ProductID, BatchID)
);

-- 5. 订货（表 12）
CREATE TABLE PurchaseOrder (
  OrderID            INTEGER PRIMARY KEY AUTOINCREMENT,
  OrderNo            TEXT NOT NULL UNIQUE,
  SupplierID         INTEGER NOT NULL REFERENCES Supplier(SupplierID),
  SubmittedBy        INTEGER NOT NULL REFERENCES Employee(EmployeeID),
  SubmittedAt        TEXT NOT NULL,
  ExpectedArrivalDate TEXT NOT NULL,
  OrderStatus        TEXT NOT NULL DEFAULT 'Submitted',
  TotalAmount        REAL NOT NULL DEFAULT 0,
  ClientNo           TEXT,
  Note               TEXT,
  RecordStatus       TEXT NOT NULL DEFAULT 'A',
  CreatedAt          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IX_PO_Supplier_Date ON PurchaseOrder(SupplierID, SubmittedAt);

CREATE TABLE PurchaseOrderLine (
  OrderID     INTEGER NOT NULL REFERENCES PurchaseOrder(OrderID),
  LineNo      INTEGER NOT NULL,
  ProductID   INTEGER NOT NULL REFERENCES Product(ProductID),
  Quantity    REAL NOT NULL CHECK (Quantity > 0),
  AgreedPrice REAL NOT NULL,
  ReceivedQty REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (OrderID, LineNo)
);

-- 6. 收货与验收（表 36、表 37）
CREATE TABLE ReceiptNote (
  ReceiptID        INTEGER PRIMARY KEY AUTOINCREMENT,
  ReceiptNo        TEXT NOT NULL UNIQUE,
  OrderID          INTEGER REFERENCES PurchaseOrder(OrderID),
  SupplierID       INTEGER NOT NULL REFERENCES Supplier(SupplierID),
  InspectedBy      INTEGER NOT NULL REFERENCES Employee(EmployeeID),
  ReceivedAt       TEXT NOT NULL,
  InspectionResult TEXT NOT NULL DEFAULT '合格',
  DiffNote         TEXT,
  RecordStatus     TEXT NOT NULL DEFAULT 'A',
  CreatedAt        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IX_Receipt_Supplier_Date ON ReceiptNote(SupplierID, ReceivedAt);

CREATE TABLE ReceiptLine (
  ReceiptID     INTEGER NOT NULL REFERENCES ReceiptNote(ReceiptID),
  LineNo        INTEGER NOT NULL,
  ProductID     INTEGER NOT NULL REFERENCES Product(ProductID),
  BatchID       INTEGER REFERENCES PurchaseBatch(BatchID),
  OrderedQty    REAL NOT NULL DEFAULT 0,
  ReceivedQty   REAL NOT NULL DEFAULT 0,
  RejectedQty   REAL NOT NULL DEFAULT 0,
  RejectionNote TEXT,
  PurchasePrice REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (ReceiptID, LineNo)
);
CREATE INDEX IX_ReceiptLine_Product ON ReceiptLine(ProductID);
CREATE INDEX IX_ReceiptLine_Batch ON ReceiptLine(BatchID);

-- 7. 临期处理与折价（表 12）
CREATE TABLE ExpiryHandling (
  HandlingID INTEGER PRIMARY KEY AUTOINCREMENT,
  HandlingNo TEXT NOT NULL UNIQUE,
  HandledBy  INTEGER NOT NULL REFERENCES Employee(EmployeeID),
  HandledAt  TEXT NOT NULL,
  Status     TEXT NOT NULL DEFAULT 'Draft',
  Note       TEXT,
  RecordStatus TEXT NOT NULL DEFAULT 'A',
  CreatedAt  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE HandlingLine (
  HandlingID   INTEGER NOT NULL REFERENCES ExpiryHandling(HandlingID),
  LineNo       INTEGER NOT NULL,
  ProductID    INTEGER NOT NULL REFERENCES Product(ProductID),
  BatchID      INTEGER NOT NULL REFERENCES PurchaseBatch(BatchID),
  PickedQty    REAL NOT NULL DEFAULT 0,
  HandlingType TEXT NOT NULL DEFAULT 'Markdown',
  Result       TEXT,
  PRIMARY KEY (HandlingID, LineNo)
);

CREATE TABLE MarkdownPlan (
  PlanID         INTEGER PRIMARY KEY AUTOINCREMENT,
  HandlingID     INTEGER NOT NULL REFERENCES ExpiryHandling(HandlingID),
  LineNo         INTEGER NOT NULL,
  RuleID         INTEGER REFERENCES MarkdownRule(RuleID),
  MarkdownTime   TEXT NOT NULL,
  DiscountRate   REAL NOT NULL,
  MarkdownPrice  REAL NOT NULL,
  PriceTagStatus TEXT NOT NULL DEFAULT 'Pending',
  ConfirmedBy    INTEGER REFERENCES Employee(EmployeeID),
  ConfirmedAt    TEXT,
  PlanStatus     TEXT NOT NULL DEFAULT 'Pending',
  Note           TEXT,
  CreatedAt      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE LossReport (
  LossID       INTEGER PRIMARY KEY AUTOINCREMENT,
  LossNo       TEXT NOT NULL UNIQUE,
  ProductID    INTEGER NOT NULL REFERENCES Product(ProductID),
  BatchID      INTEGER NOT NULL REFERENCES PurchaseBatch(BatchID),
  Quantity     REAL NOT NULL CHECK (Quantity > 0),
  Reason       TEXT NOT NULL,
  Amount       REAL NOT NULL DEFAULT 0,
  RegisteredBy INTEGER NOT NULL REFERENCES Employee(EmployeeID),
  RegisteredAt TEXT NOT NULL,
  ConfirmedBy  INTEGER REFERENCES Employee(EmployeeID),
  ConfirmedAt  TEXT,
  Status       TEXT NOT NULL DEFAULT 'Pending',
  RecordStatus TEXT NOT NULL DEFAULT 'A',
  CreatedAt    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE ReturnNote (
  ReturnID    INTEGER PRIMARY KEY AUTOINCREMENT,
  ReturnNo    TEXT NOT NULL UNIQUE,
  SupplierID  INTEGER NOT NULL REFERENCES Supplier(SupplierID),
  ProductID   INTEGER NOT NULL REFERENCES Product(ProductID),
  BatchID     INTEGER REFERENCES PurchaseBatch(BatchID),
  Quantity    REAL NOT NULL,
  UnitPrice   REAL NOT NULL,
  Amount      REAL NOT NULL,
  Reason      TEXT,
  ReturnedAt  TEXT NOT NULL,
  Status      TEXT NOT NULL DEFAULT 'Confirmed',
  RecordStatus TEXT NOT NULL DEFAULT 'A',
  CreatedAt   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE ExpenseNote (
  ExpenseID   INTEGER PRIMARY KEY AUTOINCREMENT,
  ExpenseNo   TEXT NOT NULL UNIQUE,
  SupplierID  INTEGER NOT NULL REFERENCES Supplier(SupplierID),
  ExpenseType TEXT NOT NULL,
  Amount      REAL NOT NULL,
  Period      TEXT NOT NULL,
  Voucher     TEXT,
  RegisteredBy INTEGER REFERENCES Employee(EmployeeID),
  OccurredAt  TEXT NOT NULL,
  Status      TEXT NOT NULL DEFAULT 'Confirmed',
  RecordStatus TEXT NOT NULL DEFAULT 'A',
  CreatedAt   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 8. 对账、应付与付款（表 12）
CREATE TABLE Statement (
  StatementID      INTEGER PRIMARY KEY AUTOINCREMENT,
  StatementNo      TEXT NOT NULL UNIQUE,
  SupplierID       INTEGER NOT NULL REFERENCES Supplier(SupplierID),
  PeriodStart      TEXT NOT NULL,
  PeriodEnd        TEXT NOT NULL,
  SubmittedBy      INTEGER REFERENCES Employee(EmployeeID),
  SubmittedAt      TEXT NOT NULL,
  StatementStatus  TEXT NOT NULL DEFAULT 'Submitted',
  ConfirmedBy      INTEGER REFERENCES Employee(EmployeeID),
  ConfirmedAt      TEXT,
  PurchaseAmount   REAL NOT NULL DEFAULT 0,
  ReturnAmount     REAL NOT NULL DEFAULT 0,
  ExpenseAmount    REAL NOT NULL DEFAULT 0,
  CounterpartyAmount REAL NOT NULL DEFAULT 0,
  OurAmount        REAL NOT NULL DEFAULT 0,
  DiffAmount       REAL NOT NULL DEFAULT 0,
  PayableAmount    REAL NOT NULL DEFAULT 0,
  Note             TEXT,
  RecordStatus     TEXT NOT NULL DEFAULT 'A',
  CreatedAt        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE StatementLine (
  StatementLineID   INTEGER PRIMARY KEY AUTOINCREMENT,
  StatementID       INTEGER NOT NULL REFERENCES Statement(StatementID),
  LineNo            INTEGER NOT NULL,
  SourceType        TEXT NOT NULL,
  SourceDocID       INTEGER,
  SourceDocNo       TEXT,
  OccurredDate      TEXT,
  CounterpartyAmount REAL NOT NULL DEFAULT 0,
  OurAmount         REAL NOT NULL DEFAULT 0,
  DiffAmount        REAL NOT NULL DEFAULT 0,
  DiffReason        TEXT,
  DisputedFlag      TEXT NOT NULL DEFAULT 'N',
  Resolution        TEXT,
  Voucher           TEXT,
  CreatedAt         TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE AccountPayable (
  PayableID       INTEGER PRIMARY KEY AUTOINCREMENT,
  PayableNo       TEXT NOT NULL UNIQUE,
  SupplierID      INTEGER NOT NULL REFERENCES Supplier(SupplierID),
  StatementID     INTEGER REFERENCES Statement(StatementID),
  PaymentTermDays INTEGER NOT NULL DEFAULT 30,
  PlannedPayDate  TEXT NOT NULL,
  PayableAmount   REAL NOT NULL,
  PaidAmount      REAL NOT NULL DEFAULT 0,
  PayableStatus   TEXT NOT NULL DEFAULT 'Open',
  CreatedAt       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE PaymentRecord (
  PaymentID   INTEGER PRIMARY KEY AUTOINCREMENT,
  PayNo       TEXT NOT NULL UNIQUE,
  PayableID   INTEGER NOT NULL REFERENCES AccountPayable(PayableID),
  Amount      REAL NOT NULL CHECK (Amount > 0),
  Method      TEXT NOT NULL,
  PaidAt      TEXT NOT NULL,
  RegisteredBy INTEGER REFERENCES Employee(EmployeeID),
  Note        TEXT,
  CreatedAt   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- 9. 顾客、会员、积分（表 18）
CREATE TABLE Customer (
  CustomerID     INTEGER PRIMARY KEY AUTOINCREMENT,
  Name           TEXT NOT NULL,
  Phone          TEXT,
  Address        TEXT,
  CreditLimit    REAL NOT NULL DEFAULT 0,
  CreditTermDays INTEGER NOT NULL DEFAULT 30,
  IsMember       TEXT NOT NULL DEFAULT 'N',
  Note           TEXT,
  RecordStatus   TEXT NOT NULL DEFAULT 'A',
  CreatedAt      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE Member (
  MemberID      INTEGER PRIMARY KEY AUTOINCREMENT,
  MemberNo      TEXT NOT NULL UNIQUE,
  CustomerID    INTEGER NOT NULL UNIQUE REFERENCES Customer(CustomerID),
  JoinDate      TEXT NOT NULL,
  Level         TEXT NOT NULL DEFAULT '普通',
  Points        REAL NOT NULL DEFAULT 0,
  LastVisitDate TEXT,
  RecordStatus  TEXT NOT NULL DEFAULT 'A',
  CreatedAt     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE PointEntry (
  PointEntryID INTEGER PRIMARY KEY AUTOINCREMENT,
  MemberID     INTEGER NOT NULL REFERENCES Member(MemberID),
  EntryType    TEXT NOT NULL CHECK (EntryType IN ('earn','redeem')),
  Points       REAL NOT NULL,
  OccurredAt   TEXT NOT NULL,
  OrderRef     TEXT,
  Note         TEXT
);

-- 10. 线上订单（表 38、表 39）
CREATE TABLE OnlineOrder (
  OrderID       INTEGER PRIMARY KEY AUTOINCREMENT,
  OrderNo       TEXT NOT NULL UNIQUE,
  CustomerID    INTEGER NOT NULL REFERENCES Customer(CustomerID),
  ConfirmedBy   INTEGER REFERENCES Employee(EmployeeID),
  Channel       TEXT NOT NULL CHECK (Channel IN ('group','miniProgram','platform')),
  PlacedAt      TEXT NOT NULL,
  PromisedAt    TEXT NOT NULL,
  OrderStatus   TEXT NOT NULL DEFAULT 'Pending',
  PayMethod     TEXT,
  TotalAmount   REAL NOT NULL DEFAULT 0,
  PaidAmount    REAL NOT NULL DEFAULT 0,
  FulfilMethod  TEXT NOT NULL DEFAULT '自提',
  PickupCode    TEXT,
  ClientNo      TEXT,
  Note          TEXT,
  RecordStatus  TEXT NOT NULL DEFAULT 'A',
  CreatedAt     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IX_OnlineOrder_Status ON OnlineOrder(OrderStatus, PromisedAt);

CREATE TABLE OnlineOrderLine (
  OrderID  INTEGER NOT NULL REFERENCES OnlineOrder(OrderID),
  LineNo   INTEGER NOT NULL,
  ProductID INTEGER NOT NULL REFERENCES Product(ProductID),
  BatchID  INTEGER REFERENCES PurchaseBatch(BatchID),
  SubstitutedProductID INTEGER REFERENCES Product(ProductID),
  Quantity REAL NOT NULL,
  UnitPrice REAL NOT NULL,
  PickedQty REAL NOT NULL DEFAULT 0,
  ShortQty REAL NOT NULL DEFAULT 0,
  LineStatus TEXT NOT NULL DEFAULT 'Pending',
  PRIMARY KEY (OrderID, LineNo)
);

CREATE TABLE FulfilmentLog (
  LogID      INTEGER PRIMARY KEY AUTOINCREMENT,
  OrderID    INTEGER NOT NULL REFERENCES OnlineOrder(OrderID),
  LineNo     INTEGER,
  HandledBy  INTEGER REFERENCES Employee(EmployeeID),
  Action     TEXT NOT NULL,
  OccurredAt TEXT NOT NULL,
  Note       TEXT
);

-- 11. 熟客赊账（表 40、表 41）
CREATE TABLE CreditAccount (
  AccountID     INTEGER PRIMARY KEY AUTOINCREMENT,
  AccountNo     TEXT NOT NULL UNIQUE,
  CustomerID    INTEGER NOT NULL UNIQUE REFERENCES Customer(CustomerID),
  UsedAmount    REAL NOT NULL DEFAULT 0,
  OverdueDays   INTEGER NOT NULL DEFAULT 0,
  LastSettleDate TEXT,
  AccountStatus TEXT NOT NULL DEFAULT 'Normal',
  RecordStatus  TEXT NOT NULL DEFAULT 'A',
  CreatedAt     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE CreditEntry (
  EntryID      INTEGER PRIMARY KEY AUTOINCREMENT,
  EntryNo      TEXT NOT NULL UNIQUE,
  AccountID    INTEGER NOT NULL REFERENCES CreditAccount(AccountID),
  RegisteredBy INTEGER REFERENCES Employee(EmployeeID),
  EntryType    TEXT NOT NULL CHECK (EntryType IN ('charge','settle')),
  Amount       REAL NOT NULL,
  SettledAmount REAL NOT NULL DEFAULT 0,
  DueDate      TEXT,
  SettledAt    TEXT,
  Remark       TEXT,
  ChargeRef    TEXT,
  RecordStatus TEXT NOT NULL DEFAULT 'A',
  CreatedAt    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IX_CreditEntry_Account_Due ON CreditEntry(AccountID, DueDate);

-- 12. 进货查验（表 18）
CREATE TABLE IncomingInspection (
  InspectionID    INTEGER PRIMARY KEY AUTOINCREMENT,
  ReceiptID       INTEGER NOT NULL REFERENCES ReceiptNote(ReceiptID),
  SupplierID      INTEGER NOT NULL REFERENCES Supplier(SupplierID),
  RecordedBy      INTEGER REFERENCES Employee(EmployeeID),
  LicenceNo       TEXT,
  CertificateType TEXT,
  CertificateNo   TEXT,
  ValidUntil      TEXT,
  RecordedAt      TEXT NOT NULL,
  Status          TEXT NOT NULL DEFAULT 'Complete',
  Note            TEXT,
  RecordStatus    TEXT NOT NULL DEFAULT 'A'
);
CREATE INDEX IX_Inspection_Valid ON IncomingInspection(ValidUntil);

-- 13. 销售与收款（表 53）
CREATE TABLE SaleOrder (
  SaleID       INTEGER PRIMARY KEY AUTOINCREMENT,
  SaleNo       TEXT NOT NULL UNIQUE,
  CashierID    INTEGER NOT NULL REFERENCES Employee(EmployeeID),
  CustomerID   INTEGER REFERENCES Customer(CustomerID),
  OccurredAt   TEXT NOT NULL,
  TotalAmount  REAL NOT NULL,
  DiscountAmount REAL NOT NULL DEFAULT 0,
  PaidAmount   REAL NOT NULL DEFAULT 0,
  CreditAmount REAL NOT NULL DEFAULT 0,
  CostAmount   REAL NOT NULL DEFAULT 0,
  ProfitAmount REAL NOT NULL DEFAULT 0,
  PayStatus    TEXT NOT NULL DEFAULT 'Paid',
  Note         TEXT,
  RecordStatus TEXT NOT NULL DEFAULT 'A',
  CreatedAt    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IX_SaleOrder_Date ON SaleOrder(OccurredAt);

CREATE TABLE SaleLine (
  SaleID     INTEGER NOT NULL REFERENCES SaleOrder(SaleID),
  LineNo     INTEGER NOT NULL,
  ProductID  INTEGER NOT NULL REFERENCES Product(ProductID),
  BatchID    INTEGER REFERENCES PurchaseBatch(BatchID),
  Quantity   REAL NOT NULL,
  UnitPrice  REAL NOT NULL,
  Amount     REAL NOT NULL,
  DiscountAmount REAL NOT NULL DEFAULT 0,
  UnitCost   REAL NOT NULL DEFAULT 0,
  CostAmount REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (SaleID, LineNo)
);
CREATE INDEX IX_SaleLine_Product ON SaleLine(ProductID);

CREATE TABLE PayRecord (
  PayID    INTEGER PRIMARY KEY AUTOINCREMENT,
  SaleID   INTEGER REFERENCES SaleOrder(SaleID),
  PayMethod TEXT NOT NULL,
  PayAmount REAL NOT NULL,
  PaidAt   TEXT NOT NULL,
  TradeNo  TEXT
);

-- 14. 盘点（表 53）
CREATE TABLE StocktakePlan (
  PlanID     INTEGER PRIMARY KEY AUTOINCREMENT,
  PlanNo     TEXT NOT NULL UNIQUE,
  PlannedAt  TEXT NOT NULL,
  Scope      TEXT NOT NULL,
  FrozenAt   TEXT,
  Status     TEXT NOT NULL DEFAULT 'Counting',
  ConfirmedBy INTEGER REFERENCES Employee(EmployeeID),
  ConfirmedAt TEXT,
  DiffAmount REAL NOT NULL DEFAULT 0,
  DiffRate   REAL NOT NULL DEFAULT 0,
  Note       TEXT,
  RecordStatus TEXT NOT NULL DEFAULT 'A',
  CreatedAt  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE StocktakeLine (
  PlanID    INTEGER NOT NULL REFERENCES StocktakePlan(PlanID),
  LineNo    INTEGER NOT NULL,
  ProductID INTEGER NOT NULL REFERENCES Product(ProductID),
  BatchID   INTEGER REFERENCES PurchaseBatch(BatchID),
  BookQty   REAL NOT NULL,
  CountedQty REAL,
  DiffQty   REAL,
  DiffReason TEXT,
  UnitCost  REAL NOT NULL DEFAULT 0,
  DiffAmount REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (PlanID, LineNo)
);

CREATE TABLE StockAdjust (
  AdjustID   INTEGER PRIMARY KEY AUTOINCREMENT,
  PlanID     INTEGER NOT NULL REFERENCES StocktakePlan(PlanID),
  LineNo     INTEGER NOT NULL,
  ApprovedBy INTEGER REFERENCES Employee(EmployeeID),
  AdjustQty  REAL NOT NULL,
  AdjustReason TEXT,
  OccurredAt TEXT NOT NULL
);

-- 15. 库存流水（实现辅助：把收货/报损/退货/销售/调账四类流水落到一处，便于追溯）
CREATE TABLE StockMovement (
  MovementID INTEGER PRIMARY KEY AUTOINCREMENT,
  ProductID  INTEGER NOT NULL REFERENCES Product(ProductID),
  BatchID    INTEGER REFERENCES PurchaseBatch(BatchID),
  MoveType   TEXT NOT NULL,
  Quantity   REAL NOT NULL,
  RefType    TEXT,
  RefID      INTEGER,
  RefNo      TEXT,
  OccurredAt TEXT NOT NULL,
  OperatorID INTEGER,
  Note       TEXT
);
CREATE INDEX IX_Movement_Product ON StockMovement(ProductID, OccurredAt);

-- 16. 审计留痕（报告 8.5）
CREATE TABLE AuditLog (
  LogID      INTEGER PRIMARY KEY AUTOINCREMENT,
  EmployeeID INTEGER,
  EmployeeName TEXT,
  Role       TEXT,
  Action     TEXT NOT NULL,
  Entity     TEXT,
  EntityID   TEXT,
  Detail     TEXT,
  IP         TEXT,
  CreatedAt  TEXT NOT NULL
);
CREATE INDEX IX_Audit_Date ON AuditLog(CreatedAt);

-- ============================================================
-- 视图：派生属性与清单都不建表（报告 6.2）
-- ============================================================
DROP VIEW IF EXISTS vStockSellable;
CREATE VIEW vStockSellable AS
SELECT l.LedgerID, l.ProductID, l.BatchID, l.Quantity,
       l.ReservedQty, (l.Quantity - l.ReservedQty) AS SellableQty,
       l.Location, b.ExpiryDate, b.PurchasePrice, p.CategoryID
FROM StockLedger l
JOIN PurchaseBatch b ON b.BatchID = l.BatchID
JOIN Product p ON p.ProductID = l.ProductID
WHERE l.RecordStatus = 'A' AND b.RecordStatus = 'A';

DROP VIEW IF EXISTS vExpiryWarning;
CREATE VIEW vExpiryWarning AS
SELECT l.ProductID, l.BatchID, l.Quantity, l.ReservedQty, l.Location,
       b.ProductionDate, b.ShelfLifeDays, b.ExpiryDate, b.PurchasePrice,
       CAST(julianday(b.ExpiryDate) - julianday(date('now','localtime')) AS INTEGER) AS RemainDays,
       p.ProductName, p.Barcode, p.Specification, p.Unit, p.ListPrice,
       p.CategoryID, c.CategoryName, c.ExpiryWarnRatio,
       b.SupplierID
FROM StockLedger l
JOIN PurchaseBatch b ON b.BatchID = l.BatchID
JOIN Product p ON p.ProductID = l.ProductID
JOIN ProductCategory c ON c.CategoryID = p.CategoryID
WHERE l.RecordStatus = 'A' AND b.RecordStatus = 'A' AND p.RecordStatus = 'A';

DROP VIEW IF EXISTS vProductStock;
CREATE VIEW vProductStock AS
SELECT p.ProductID, p.Barcode, p.ProductName, p.Specification, p.Unit,
       p.ListPrice, p.ShelfLifeDays, p.OnShelfFlag, p.CategoryID,
       c.CategoryName, p.SupplierID, s.Name AS SupplierName,
       ROUND(COALESCE(SUM(l.Quantity), 0), 3) AS StockQty,
       ROUND(COALESCE(SUM(l.Quantity * b.PurchasePrice), 0), 2) AS StockValue
FROM Product p
JOIN ProductCategory c ON c.CategoryID = p.CategoryID
LEFT JOIN Supplier s ON s.SupplierID = p.SupplierID
LEFT JOIN StockLedger l ON l.ProductID = p.ProductID AND l.RecordStatus = 'A'
LEFT JOIN PurchaseBatch b ON b.BatchID = l.BatchID
WHERE p.RecordStatus = 'A'
GROUP BY p.ProductID;

DROP VIEW IF EXISTS vCreditSummary;
CREATE VIEW vCreditSummary AS
SELECT a.AccountID, a.AccountNo, a.CustomerID, cu.Name AS CustomerName, cu.Phone,
       cu.CreditLimit, cu.CreditTermDays, a.UsedAmount, a.AccountStatus,
       a.LastSettleDate,
       ROUND(COALESCE(SUM(CASE WHEN e.EntryType='charge' AND e.RecordStatus='A'
             THEN e.Amount - e.SettledAmount ELSE 0 END), 0), 2) AS OutstandingAmount,
       MIN(CASE WHEN e.EntryType='charge' AND e.RecordStatus='A'
             AND e.Amount - e.SettledAmount > 0.001 AND e.SettledAt IS NULL
             THEN e.DueDate END) AS EarliestDueDate
FROM CreditAccount a
JOIN Customer cu ON cu.CustomerID = a.CustomerID
LEFT JOIN CreditEntry e ON e.AccountID = a.AccountID
GROUP BY a.AccountID;
