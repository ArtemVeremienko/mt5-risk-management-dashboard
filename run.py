"""
Direct script launcher for MT5 Risk Management Dashboard.
"""

try:
    from main import main
except ImportError:
    from risk_management_dashboard.main import main

if __name__ == "__main__":
    main()
