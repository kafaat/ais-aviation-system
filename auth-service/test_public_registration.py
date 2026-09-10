"""Execute registration with isolated boundary doubles; no live database required."""
import ast
from pathlib import Path
from types import SimpleNamespace
ROOT = Path(__file__).resolve().parents[1]
# Execute the exact registration function body with synthetic boundary objects.
module = ast.parse((ROOT / "auth-service/main.py").read_text())
register = next(n for n in module.body if isinstance(n, ast.FunctionDef) and n.name == "register")
register.decorator_list = []
class FakeUser:
    email = "email-field"
    def __init__(self, **kw): self.__dict__.update(kw)
class FakeDb:
    def query(self, *args): return self
    def filter(self, *args): return self
    def first(self): return None
    def add(self, user): self.user = user
    def commit(self): pass
    def refresh(self, user): pass
db = FakeDb()
namespace = {
    "RegisterRequest": object, "Session": object, "Depends": lambda fn: None,
    "get_db": lambda: db, "User": FakeUser,
    "uuid": SimpleNamespace(uuid4=lambda: SimpleNamespace(hex="a" * 32)),
    "pwd_context": SimpleNamespace(hash=lambda value: "synthetic-hash"),
    "settings": SimpleNamespace(OWNER_EMAIL="owner@example.test"),
    "AuthResponse": lambda **kw: SimpleNamespace(**kw),
    "UserResponse": SimpleNamespace(model_validate=lambda user: user),
}
exec(compile(ast.fix_missing_locations(ast.Module(body=[register], type_ignores=[])), "auth-service/main.py", "exec"), namespace)
result = namespace["register"](SimpleNamespace(email="owner@example.test", password="synthetic-secret", name="Synthetic registrant"), db)
assert result.user.role == "user"
print("F09: unverified registration with configured OWNER_EMAIL remains role=user (source function under doubles).")
