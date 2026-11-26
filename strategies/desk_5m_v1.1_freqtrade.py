# ============================================================
# Alta Capital — auto-generated strategy artifact
# Desk: תוך־יומי · 5 דקות · BTCUSDT · 5m
# Version: v1.1 · Strategy family: rsi_reversion
# Backtest: return 2.2% · PF 10.99 · DD 0.52% · trades 7
# OOS: 0.42% · Sharpe 21.1
# Params: {"period":12,"oversold":25,"overbought":80,"atrStop":1.5,"rr":1.6}
# Target platform: Freqtrade
# Generated: 2026-11-26T22:56:13.661Z
# Research artifact only — no warranty, no live order routing.
# ============================================================
# Drop this file in freqtrade/user_data/strategies/ and run:
#   freqtrade backtesting --strategy Altadesk_5m --config user_data/config.json
#   freqtrade trade --strategy Altadesk_5m --config user_data/config.json --dry-run

from freqtrade.strategy import IStrategy
from pandas import DataFrame
import talib.abstract as ta


class Altadesk_5m(IStrategy):
    INTERFACE_VERSION = 3

    timeframe = '5m'
    can_short = True
    startup_candle_count = 210

    stoploss = -0.018
    minimal_roi = {"0": 1.44, "240": 0.01, "720": 0}

    trailing_stop = False
    process_only_new_candles = True
    use_exit_signal = True
    exit_profit_only = False

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe['rsi'] = ta.RSI(dataframe, timeperiod=12)
        dataframe['atr'] = ta.ATR(dataframe, timeperiod=14)
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe.loc[
            (
        & (dataframe['rsi'] <= 25)
        & (dataframe['rsi'].shift(1) > 25)
                & (dataframe['volume'] > 0)
            ),
            'enter_long',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['rsi'] >= 80)
        & (dataframe['rsi'].shift(1) < 80)
                & (dataframe['volume'] > 0)
            ),
            'enter_short',
        ] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # Risk-managed exits: ATR stop + fixed R multiple handled by the engine.
        dataframe.loc[
            (
        & (dataframe['rsi'] <= 25)
        & (dataframe['rsi'].shift(1) > 25)
            ),
            'exit_short',
        ] = 1
        dataframe.loc[
            (
        & (dataframe['rsi'] >= 80)
        & (dataframe['rsi'].shift(1) < 80)
            ),
            'exit_long',
        ] = 1
        return dataframe
