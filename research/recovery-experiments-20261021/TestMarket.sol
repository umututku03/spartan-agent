// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// TEST FIXTURES ONLY. Unrestricted faucets are controlled by the evaluator.
contract TestToken {
    string public symbol;
    uint8 public immutable decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from, address indexed to, uint256 amount);
    constructor(string memory s, uint8 d) { symbol=s; decimals=d; }
    function mint(address who, uint256 n) external { balanceOf[who]+=n; emit Transfer(address(0),who,n); }
    function setBalance(address who, uint256 n) external { balanceOf[who]=n; }
    function approve(address spender, uint256 n) external returns(bool) { allowance[msg.sender][spender]=n; return true; }
    function transfer(address to, uint256 n) external returns(bool) { _move(msg.sender,to,n); return true; }
    function transferFrom(address from, address to, uint256 n) external returns(bool) {
        require(allowance[from][msg.sender]>=n,"allowance");
        if(allowance[from][msg.sender]!=type(uint256).max) allowance[from][msg.sender]-=n;
        _move(from,to,n); return true;
    }
    function _move(address from,address to,uint256 n) internal {
        require(balanceOf[from]>=n,"balance"); balanceOf[from]-=n; balanceOf[to]+=n; emit Transfer(from,to,n);
    }
}
contract TestMarket {
    TestToken public cash;
    TestToken public dai;
    bool public rejectNative;
    uint256 public reserveCash;
    uint256 public reserveDai;
    constructor(TestToken c,TestToken d) { cash=c; dai=d; }
    function setPool(uint256 c,uint256 d) external {
        reserveCash=c; reserveDai=d; cash.setBalance(address(this),c); dai.setBalance(address(this),d);
    }
    function setRejectNative(bool b) external { rejectNative=b; }
    function quote(uint256 n) public view returns(uint256) {
        return n*997*reserveDai/(reserveCash*1000+n*997);
    }
    function getAmountsOut(uint256 n,address[] calldata path) external view returns(uint256[] memory a) {
        a=new uint256[](path.length); a[0]=n;
        a[path.length-1] = path[0]==address(cash) ? quote(n) : n*2000*1e6/1e18;
    }
    function swapExactETHForTokens(uint256 minOut,address[] calldata,address to,uint256 deadline) external payable returns(uint256[] memory a) {
        require(!rejectNative,"native-rejected"); require(block.timestamp<=deadline,"expired");
        uint256 out=msg.value*2000*1e6/1e18; require(out>=minOut,"minimum-output"); cash.mint(to,out);
        a=new uint256[](2);a[0]=msg.value;a[1]=out;
    }
    function swapExactTokensForTokens(uint256 n,uint256 minOut,address[] calldata,address to,uint256 deadline) external returns(uint256[] memory a) {
        require(block.timestamp<=deadline,"expired"); uint256 out=_swap(msg.sender,to,n,minOut);
        a=new uint256[](2);a[0]=n;a[1]=out;
    }
    function swapWithFloor(uint256 n,uint256 minOut,uint256 floor) external returns(uint256 out) {
        out=_swap(msg.sender,msg.sender,n,minOut);
        require(cash.balanceOf(msg.sender)>=floor,"reserve-floor");
    }
    function _swap(address from,address to,uint256 n,uint256 minOut) internal returns(uint256 out) {
        out=quote(n);require(out>=minOut,"minimum-output");
        cash.transferFrom(from,address(this),n);dai.transfer(to,out);
        reserveCash+=n;reserveDai-=out;
    }
}
