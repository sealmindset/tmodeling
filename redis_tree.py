import redis
from anytree import Node, RenderTree
import argparse

def get_redis_keys(client, pattern):
    """Fetch all keys matching the given pattern."""
    return client.keys(pattern)

def fetch_redis_data(client, subject):
    """Fetch the data for a given subject."""
    data = {}
    data['response'] = client.get(f'gpt-response:{subject}')
    data['title'] = client.get(f'title:{subject}')
    data['summary'] = client.get(f'summary:{subject}')
    data['model'] = client.get(f'model:{subject}')
    return data

def build_tree(subject, data):
    """Build a tree structure for the subject and its data."""
    root = Node(subject)
    for key, value in data.items():
        Node(f"{key}: {value}", parent=root)
    return root

def display_tree(root):
    """Render and print the tree structure."""
    for pre, fill, node in RenderTree(root):
        print("%s%s" % (pre, node.name))

def main(subject, redis_host='localhost', redis_port=6379):
    client = redis.StrictRedis(host=redis_host, port=redis_port, decode_responses=True)
    
    data = fetch_redis_data(client, subject)
    tree_root = build_tree(subject, data)
    display_tree(tree_root)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Display Redis data hierarchy for a given subject.')
    parser.add_argument('subject', type=str, help='The subject to display the hierarchy for')
    parser.add_argument('--redis_host', type=str, default='localhost', help='Redis host')
    parser.add_argument('--redis_port', type=int, default=6379, help='Redis port')
    args = parser.parse_args()
    
    main(args.subject, args.redis_host, args.redis_port)
