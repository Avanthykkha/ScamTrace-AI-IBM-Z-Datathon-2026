"""Initialize the local demo database and report persisted transaction count."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.main import connect, init


def main() -> None:
    init()
    with connect() as connection:
        count = connection.execute(
            "SELECT COUNT(*) FROM correlation_store.transactions"
        ).fetchone()[0]
    print(f"SQLite initialized; persisted transactions: {count}")


if __name__ == "__main__":
    main()
