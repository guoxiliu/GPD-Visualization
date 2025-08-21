import numpy as np
import sys


if __name__ == "__main__":
    if len(sys.argv) > 1:
        filename = sys.argv[1]
    else:
        print("Usage: python readData.py <filename.npy>")
        sys.exit(1)

    try:
        # Load the data from the specified file
        data = np.load(filename)
        print("Data loaded successfully:")
        print("data shape:", data.shape)
        print("min: ", np.min(data))
        print("max: ", np.max(data))
        print("mean: ", np.mean(data))
        # print(data)
    except Exception as e:
        print(f"Error loading data: {e}")
        sys.exit(1)
