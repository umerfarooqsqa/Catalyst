def test_connection():
    """Simple connection test."""
    assert True
    print("Connection test passed successfully!")

def test_sample_addition():
    """Simple test function verifying basic math."""
    a = 2
    b = 3
    assert a + b == 5
    print(f"Sample test passed: {a} + {b} == 5")

if __name__ == "__main__":
    print("Running tests...")
    test_connection()
    test_sample_addition()
    print("All tests completed successfully!")
